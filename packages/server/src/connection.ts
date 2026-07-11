import {
  createConnection,
  TextDocuments,
  TextDocumentSyncKind,
  CompletionItemKind as LspCompletionItemKind,
  DiagnosticSeverity,
  SymbolKind as LspSymbolKind,
} from "vscode-languageserver";
import type {
  Connection,
  DocumentSymbol,
  CompletionItem as LspCompletionItem,
  InitializeParams,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { parseDocument } from "@oasis/core";
import { getDefinition } from "./handlers/definition.ts";
import { getHover } from "./handlers/hover.ts";
import { getCompletions } from "./handlers/completion.ts";
import { getDocumentSymbols } from "./handlers/document-symbol.ts";
import type { SymbolNodeKind, SymbolResult } from "./handlers/document-symbol.ts";
import { getDiagnosticsByFile, toLspRange } from "./diagnostics.ts";
import { routeDocument } from "./document-routing.ts";
import { OverlayFileSystem } from "./overlay-fs.ts";
import { isConfigFilePath, loadConfigFilesFromInit, loadProjectAtPath, scanWorkspaceRootsForProjects } from "./project.ts";
import { createServerContext, invalidateGraph } from "./workspace.ts";

const DEBOUNCE_MS = 250;

function uriToPath(uri: string): string {
  return URI.parse(uri).fsPath;
}

function pathToUri(path: string): string {
  return URI.file(path).toString();
}

/** Absolute filesystem roots of every workspace folder the client reported at initialize. */
function workspaceRootsFromInitialize(params: InitializeParams): string[] {
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    return params.workspaceFolders.map((folder) => uriToPath(folder.uri));
  }
  if (params.rootUri) return [uriToPath(params.rootUri)];
  return [];
}

const SYMBOL_KIND_MAP: Record<SymbolNodeKind, LspSymbolKind> = {
  namespace: LspSymbolKind.Namespace,
  operation: LspSymbolKind.Method,
  object: LspSymbolKind.Object,
  info: LspSymbolKind.Namespace,
};

function toLspSymbol(symbol: SymbolResult): DocumentSymbol {
  const range = toLspRange(symbol.range);
  return {
    name: symbol.name,
    kind: SYMBOL_KIND_MAP[symbol.kind],
    range,
    selectionRange: range,
    children: symbol.children.map(toLspSymbol),
  };
}

/** Wire up a live LSP connection over stdio. */
export function startServer(): Connection {
  // Explicit stdio streams (rather than the zero-arg "infer from argv" overload) so the server
  // doesn't depend on how it happens to be spawned. Cast avoids an @types/node version mismatch
  // between this repo's types and vscode-languageserver-protocol's own bundled stream typings.
  const connection = createConnection(process.stdin as never, process.stdout as never);
  const documents = new TextDocuments(TextDocument);

  const fileSystem = new OverlayFileSystem((path) => {
    const doc = documents.get(pathToUri(path));
    return doc?.getText();
  });
  const ctx = createServerContext(fileSystem);

  let workspaceRoots: string[] = [];
  let initConfigFiles: unknown;

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastPublishedFiles = new Map<string, Set<string>>();

  async function validate(entryPath: string): Promise<void> {
    const byFile = await getDiagnosticsByFile(ctx, entryPath);
    const prev = lastPublishedFiles.get(entryPath) ?? new Set<string>();
    for (const file of prev) {
      if (!byFile.has(file)) {
        connection.sendDiagnostics({ uri: pathToUri(file), diagnostics: [] });
      }
    }
    for (const [file, diagnostics] of byFile) {
      connection.sendDiagnostics({ uri: pathToUri(file), diagnostics });
    }
    lastPublishedFiles.set(entryPath, new Set(byFile.keys()));
  }

  /** Clear previously-published diagnostics for an entry whose project was unloaded (config
   * deleted, or the entry dropped from `entries`), so stale diagnostics don't linger. */
  function clearPublishedFor(entryPath: string): void {
    const prev = lastPublishedFiles.get(entryPath);
    if (!prev) return;
    for (const file of prev) {
      connection.sendDiagnostics({ uri: pathToUri(file), diagnostics: [] });
    }
    lastPublishedFiles.delete(entryPath);
  }

  function scheduleValidate(entryPath: string): void {
    const existing = debounceTimers.get(entryPath);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      entryPath,
      setTimeout(() => {
        debounceTimers.delete(entryPath);
        void validate(entryPath);
      }, DEBOUNCE_MS),
    );
  }

  function publishConfigWarnings(configPath: string, warnings: string[]): void {
    const configDiagnostics = warnings.map((message) => ({
      message,
      severity: DiagnosticSeverity.Warning,
      source: "oasis",
      code: "config",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    }));
    connection.sendDiagnostics({ uri: pathToUri(configPath), diagnostics: configDiagnostics });
  }

  /** Build (or rebuild) every loaded project's entry graphs and publish diagnostics immediately,
   * with nothing needing to be open. */
  async function publishAllProjects(): Promise<void> {
    for (const project of ctx.projects.values()) {
      for (const entryPath of project.entryPaths) {
        await validate(entryPath);
      }
    }
  }

  /** Discover and eagerly load every project reachable at startup: a root-of-workspace-folder
   * scan (works for any client) plus any config paths the client discovered itself via a deep scan
   * (`initializationOptions.configFiles`, e.g. VSCode's `findFiles`). Both dedupe naturally since
   * projects are keyed by resolved config path. */
  async function initializeProjects(): Promise<void> {
    await scanWorkspaceRootsForProjects(ctx, workspaceRoots);
    await loadConfigFilesFromInit(ctx, initConfigFiles);
    for (const project of ctx.projects.values()) {
      publishConfigWarnings(project.configPath, project.warnings);
    }
    await publishAllProjects();
  }

  /** Reload (or unload) the single project whose config file is `configPath` — used for
   * `didChangeWatchedFiles`/didOpen/didChange on that specific config file, so editing one
   * project's config never disturbs another's state. */
  async function reloadProjectAtConfigPath(configPath: string): Promise<void> {
    const before = ctx.projects.get(configPath);
    const after = await loadProjectAtPath(ctx, configPath);

    // Clear diagnostics for entries that dropped out of this project (including all of them, if
    // the project was unloaded entirely) so stale diagnostics don't linger.
    const afterEntries = new Set(after?.entryPaths ?? []);
    for (const entryPath of before?.entryPaths ?? []) {
      if (!afterEntries.has(entryPath)) clearPublishedFor(entryPath);
    }

    // Always publish (possibly empty) so a previously-reported missing-entry warning clears once
    // the config is fixed, and so a deleted config's warnings are cleared too.
    publishConfigWarnings(configPath, after?.warnings ?? []);

    if (after) {
      for (const entryPath of after.entryPaths) {
        await validate(entryPath);
      }
    }
  }

  /** Route a document open/change to the right place: a specific project-config reload, the
   * owning project entry's re-lint, a standalone OpenAPI entry's re-lint, or silent ignore for
   * anything else. */
  async function handleDocumentEvent(path: string, text: string): Promise<void> {
    invalidateGraph(ctx, path);

    const route = await routeDocument(ctx, path, text);
    switch (route.kind) {
      case "config":
        await reloadProjectAtConfigPath(path);
        return;
      case "project-member":
      case "standalone":
        scheduleValidate(route.entryPath);
        return;
      case "ignored":
        // Not a project member and doesn't look like an OpenAPI document: ignore it rather than
        // linting it as a broken standalone entry (avoids spurious "Missing required field
        // openapi" noise now that the client may sync every yaml/json/jsonc file).
        connection.sendDiagnostics({ uri: pathToUri(path), diagnostics: [] });
        return;
    }
  }

  connection.onShutdown(() => {});
  connection.onExit(() => process.exit(0));

  connection.onInitialize((params) => {
    workspaceRoots = workspaceRootsFromInitialize(params);
    const options = params.initializationOptions as { configFiles?: unknown } | undefined;
    initConfigFiles = options?.configFiles;
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        definitionProvider: true,
        hoverProvider: true,
        completionProvider: { triggerCharacters: ['"', ":", "/", "#", "'", "$"] },
        documentSymbolProvider: true,
      },
    };
  });

  connection.onInitialized(() => {
    void initializeProjects();
  });

  connection.onDidChangeWatchedFiles((params) => {
    for (const change of params.changes) {
      const path = uriToPath(change.uri);
      if (isConfigFilePath(path)) {
        void reloadProjectAtConfigPath(path);
      }
    }
  });

  documents.onDidOpen((event) => {
    void handleDocumentEvent(uriToPath(event.document.uri), event.document.getText());
  });

  documents.onDidChangeContent((event) => {
    void handleDocumentEvent(uriToPath(event.document.uri), event.document.getText());
  });

  documents.onDidClose((event) => {
    const path = uriToPath(event.document.uri);
    invalidateGraph(ctx, path);
    const timer = debounceTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      debounceTimers.delete(path);
    }
  });

  connection.onDefinition(async (params) => {
    const path = uriToPath(params.textDocument.uri);
    const result = await getDefinition(ctx, { path, position: params.position });
    if (!result) return null;
    return { uri: pathToUri(result.targetPath), range: toLspRange(result.range) };
  });

  connection.onHover(async (params) => {
    const path = uriToPath(params.textDocument.uri);
    const result = await getHover(ctx, { path, position: params.position });
    if (!result) return null;
    return { contents: { kind: "markdown", value: result.contents } };
  });

  connection.onCompletion(async (params) => {
    const path = uriToPath(params.textDocument.uri);
    const items = await getCompletions(ctx, { path, position: params.position });
    return items.map(
      (item): LspCompletionItem => ({
        label: item.label,
        kind: item.kind === "ref" ? LspCompletionItemKind.Reference : LspCompletionItemKind.Property,
        insertText: item.insertText,
        filterText: item.filterText,
        textEdit: item.textEdit
          ? { range: { start: item.textEdit.range.start, end: item.textEdit.range.end }, newText: item.textEdit.newText }
          : undefined,
      }),
    );
  });

  connection.onDocumentSymbol((params) => {
    const path = uriToPath(params.textDocument.uri);
    const open = documents.get(params.textDocument.uri);
    const doc = open ? parseDocument(open.getText(), path) : undefined;
    if (!doc) return [];
    return getDocumentSymbols(doc).map(toLspSymbol);
  });

  documents.listen(connection);
  connection.listen();
  return connection;
}
