import {
  createConnection,
  TextDocuments,
  TextDocumentSyncKind,
  CompletionItemKind as LspCompletionItemKind,
  SymbolKind as LspSymbolKind,
} from "vscode-languageserver";
import type { Connection, DocumentSymbol, CompletionItem as LspCompletionItem } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { parseDocument } from "@oasis/core";
import { getDefinition } from "./handlers/definition.ts";
import { getHover } from "./handlers/hover.ts";
import { getCompletions } from "./handlers/completion.ts";
import { getDocumentSymbols } from "./handlers/document-symbol.ts";
import type { SymbolNodeKind, SymbolResult } from "./handlers/document-symbol.ts";
import { getDiagnosticsByFile, toLspRange } from "./diagnostics.ts";
import { OverlayFileSystem } from "./overlay-fs.ts";
import { createServerContext, invalidateGraph } from "./workspace.ts";

const DEBOUNCE_MS = 250;

function uriToPath(uri: string): string {
  return URI.parse(uri).fsPath;
}

function pathToUri(path: string): string {
  return URI.file(path).toString();
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

  connection.onShutdown(() => {});
  connection.onExit(() => process.exit(0));

  connection.onInitialize(() => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      hoverProvider: true,
      completionProvider: { triggerCharacters: ['"', ":", "/", "#"] },
      documentSymbolProvider: true,
    },
  }));

  documents.onDidOpen((event) => {
    const path = uriToPath(event.document.uri);
    invalidateGraph(ctx, path);
    scheduleValidate(path);
  });

  documents.onDidChangeContent((event) => {
    const path = uriToPath(event.document.uri);
    invalidateGraph(ctx, path);
    scheduleValidate(path);
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
