import { resolve as pathResolve, sep } from "node:path";
import {
  createConnection,
  FileChangeType,
  TextDocuments,
  TextDocumentSyncKind,
  CompletionItemKind as LspCompletionItemKind,
  DiagnosticSeverity,
  SymbolKind as LspSymbolKind,
} from "vscode-languageserver";
import type {
  CodeAction as LspCodeAction,
  Connection,
  DocumentSymbol,
  CompletionItem as LspCompletionItem,
  InitializeParams,
  SymbolInformation,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { parseDocument } from "@oasis/core";
import type { Range } from "@oasis/core";
import { getCodeActions } from "./handlers/code-actions.ts";
import { getDefinition } from "./handlers/definition.ts";
import { getDocumentLinks } from "./handlers/document-link.ts";
import { getHover } from "./handlers/hover.ts";
import { getCompletions } from "./handlers/completion.ts";
import { getDocumentSymbols } from "./handlers/document-symbol.ts";
import { getReferences } from "./handlers/references.ts";
import { prepareRename, renameComponent } from "./handlers/rename.ts";
import { getWorkspaceSymbols } from "./handlers/workspace-symbol.ts";
import type { SymbolNodeKind, SymbolResult } from "./handlers/document-symbol.ts";
import type { WorkspaceSymbolKind } from "./handlers/workspace-symbol.ts";
import { toLspRange } from "./diagnostics.ts";
import { routeDocument } from "./document-routing.ts";
import { OverlayFileSystem } from "./overlay-fs.ts";
import {
  isConfigFilePath,
  loadConfigFilesFromInit,
  loadProjectAtPath,
  resolveConfigForEntry,
  scanWorkspaceRootsForProjects,
} from "./project.ts";
import { createValidationRunner } from "./validation.ts";
import { createUriPathMapper } from "./uri-path.ts";
import { createServerContext, findEntriesLastContaining, invalidateGraph } from "./workspace.ts";

const DEBOUNCE_MS = 250;

/** Run a fire-and-forget async handler (a notification callback with no caller to await it) so
 * that an exception anywhere in the diagnostics/config pipeline is logged instead of becoming an
 * unhandled rejection that kills the whole server process. */
export function runSafely(connection: Connection, label: string, task: () => Promise<void>): void {
  // `Promise.resolve().then(task)` (rather than calling `task()` directly) so a *synchronous*
  // throw inside `task` (e.g. `toPath` rejecting a malformed URI) becomes a rejection this
  // function's `.catch` observes too, instead of propagating out of `runSafely` itself.
  Promise.resolve()
    .then(task)
    .catch((error: unknown) => {
      connection.console.error(`[oasis] ${label} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    });
}

/** Absolute filesystem roots of every workspace folder the client reported at initialize. Workspace
 * folders are `file:` URIs (remote folders are out of scope for on-disk scanning), so a plain
 * `fsPath` conversion is correct here. */
function workspaceRootsFromInitialize(params: InitializeParams): string[] {
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    return params.workspaceFolders.map((folder) => URI.parse(folder.uri).fsPath);
  }
  if (params.rootUri) return [URI.parse(params.rootUri).fsPath];
  return [];
}

function isPathAtOrUnder(path: string, root: string): boolean {
  const resolvedPath = pathResolve(path);
  const resolvedRoot = pathResolve(root);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + sep);
}

/** Group flat file edits into the LSP `WorkspaceEdit.changes` shape (uri -> TextEdit[]). Paths are
 * mapped back through `toUri` so edits to an untitled/remote document keep its original URI. */
function groupEditsByUri(
  edits: { filePath: string; range: Range; newText: string }[],
  toUri: (path: string) => string,
): Record<string, { range: ReturnType<typeof toLspRange>; newText: string }[]> {
  const changes: Record<string, { range: ReturnType<typeof toLspRange>; newText: string }[]> = {};
  for (const edit of edits) {
    const uri = toUri(edit.filePath);
    (changes[uri] ??= []).push({ range: toLspRange(edit.range), newText: edit.newText });
  }
  return changes;
}

const SYMBOL_KIND_MAP: Record<SymbolNodeKind, LspSymbolKind> = {
  namespace: LspSymbolKind.Namespace,
  operation: LspSymbolKind.Method,
  object: LspSymbolKind.Object,
  info: LspSymbolKind.Namespace,
};

const WORKSPACE_SYMBOL_KIND_MAP: Record<WorkspaceSymbolKind, LspSymbolKind> = {
  class: LspSymbolKind.Class,
  variable: LspSymbolKind.Variable,
  interface: LspSymbolKind.Interface,
  key: LspSymbolKind.Key,
  method: LspSymbolKind.Method,
  object: LspSymbolKind.Object,
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

  // Maps between the canonical paths the graph keys documents by and the original open-document
  // URIs, so `untitled:`/`vscode-remote:` documents keep their identity for overlay lookups and
  // every published response (issue #115).
  const { toPath, toUri, forget } = createUriPathMapper();

  const fileSystem = new OverlayFileSystem((path) => {
    const doc = documents.get(toUri(path));
    return doc?.getText();
  });
  const ctx = createServerContext(fileSystem);

  let workspaceRoots: string[] = [];
  let initConfigFiles: unknown;
  let clientSupportsWorkspaceFolders = false;

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Per-entry diagnostics bookkeeping (issue #48): diagnostics are stored per `entry -> file` and
  // every publish is the merged, deduplicated union across entries, so a file shared by several
  // entry graphs never has one entry's findings clobber another's.
  const runner = createValidationRunner(ctx, {
    publish: (filePath, diagnostics) => connection.sendDiagnostics({ uri: toUri(filePath), diagnostics }),
  });
  // The config path a standalone (non-project-member) entry last had a config warning published
  // against, so a later validate() that resolves to no warning (or a different config path) can
  // clear the stale one rather than leaving it to linger (see `resolveConfigForEntry`).
  const standaloneConfigWarningPaths = new Map<string, string>();

  async function validate(entryPath: string): Promise<void> {
    await runner.validate(entryPath);

    // Standalone entries have no project registration to hang a config warning off of
    // (`reloadProjectAtConfigPath` only runs for project config paths), so surface/clear the
    // nearest-config resolution's own warnings (e.g. a parse error) here instead.
    const resolved = await resolveConfigForEntry(ctx, entryPath);
    const prevWarningPath = standaloneConfigWarningPaths.get(entryPath);
    if (prevWarningPath && prevWarningPath !== resolved.configPath) {
      publishConfigWarnings(prevWarningPath, []);
      standaloneConfigWarningPaths.delete(entryPath);
    }
    if (resolved.configPath && resolved.warnings.length > 0) {
      publishConfigWarnings(resolved.configPath, resolved.warnings);
      standaloneConfigWarningPaths.set(entryPath, resolved.configPath);
    } else if (resolved.configPath && prevWarningPath === resolved.configPath) {
      publishConfigWarnings(resolved.configPath, []);
      standaloneConfigWarningPaths.delete(entryPath);
    }
  }

  /** Clear previously-published diagnostics for an entry whose project was unloaded (config
   * deleted, or the entry dropped from `entries`), so stale diagnostics don't linger. Only this
   * entry's *contribution* is removed: a file shared with a sibling entry keeps the sibling's
   * diagnostics (see `createValidationRunner`). */
  function clearPublishedFor(entryPath: string): void {
    runner.clearEntry(entryPath);
  }

  function scheduleValidate(entryPath: string): void {
    const existing = debounceTimers.get(entryPath);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      entryPath,
      setTimeout(() => {
        debounceTimers.delete(entryPath);
        runSafely(connection, "validate", () => validate(entryPath));
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
    connection.sendDiagnostics({ uri: toUri(configPath), diagnostics: configDiagnostics });
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
    const scanned = await scanWorkspaceRootsForProjects(ctx, workspaceRoots);
    const fromInit = await loadConfigFilesFromInit(ctx, initConfigFiles);
    // Publish warnings for every config `loadProjectAtPath` produced a state for, including
    // configs that never registered as a project (e.g. a first-ever parse error, or an
    // override-only config with no `entries`) — see `loadProjectAtPath`'s synthetic-state case.
    const seen = new Set<string>();
    for (const state of [...scanned, ...fromInit]) {
      if (seen.has(state.configPath)) continue;
      seen.add(state.configPath);
      publishConfigWarnings(state.configPath, state.warnings);
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
    // the project was unloaded entirely) so stale diagnostics don't linger. Also cancel any
    // debounce still pending for a dropped entry (issue #113): otherwise a timer scheduled just
    // before this reload (e.g. a watched-file change) fires later and republishes the removed
    // entry's now-stale diagnostics right after this clear.
    const afterEntries = new Set(after?.entryPaths ?? []);
    const removedEntries = (before?.entryPaths ?? []).filter((entryPath) => !afterEntries.has(entryPath));
    for (const entryPath of removedEntries) {
      const timer = debounceTimers.get(entryPath);
      if (timer) {
        clearTimeout(timer);
        debounceTimers.delete(entryPath);
      }
      clearPublishedFor(entryPath);
    }

    // Always publish (possibly empty) so a previously-reported missing-entry warning clears once
    // the config is fixed, and so a deleted config's warnings are cleared too.
    publishConfigWarnings(configPath, after?.warnings ?? []);

    if (after) {
      for (const entryPath of after.entryPaths) {
        await validate(entryPath);
      }
    }

    // A removed entry that's still open doesn't just vanish from the client's perspective (issue
    // #113): route it again from its overlay text, exactly like any other document event, so it
    // becomes a standalone entry — and gets validated by the loop below — if it's still a root
    // OpenAPI document, rather than being left cleared and unvalidated until it's next edited or
    // reopened.
    for (const entryPath of removedEntries) {
      const openText = documents.get(toUri(entryPath))?.getText();
      if (openText === undefined) continue;
      invalidateGraph(ctx, entryPath);
      await routeDocument(ctx, entryPath, openText);
    }

    // A config change/create/delete can also change which config governs a standalone
    // (non-project-member) document — including an override-only config (no `entries`) that never
    // registers as a project at all, so the `after`-driven loop above never touches it, and now also
    // any removed entry the loop above just rerouted to standalone.
    // `loadProjectAtPath` already invalidated `ctx.standaloneConfigCache`; re-validate every
    // currently-open standalone document so the new resolution takes effect immediately rather
    // than waiting for an unrelated edit.
    for (const entryPath of ctx.openStandaloneEntries) {
      await validate(entryPath);
    }
  }

  /** Route a document open/change to the right place: a specific project-config reload, the
   * owning project entry's re-lint, a standalone OpenAPI entry's re-lint, or silent ignore for
   * anything else. */
  async function handleDocumentEvent(path: string, text: string): Promise<void> {
    invalidateGraph(ctx, path);

    const wasStandaloneEntry = ctx.openStandaloneEntries.has(path);
    const route = await routeDocument(ctx, path, text);
    if (wasStandaloneEntry && route.kind === "project-member" && route.entryPath !== path) {
      clearPublishedFor(path);
    }
    switch (route.kind) {
      case "config":
        await reloadProjectAtConfigPath(path);
        return;
      case "project-member":
      case "standalone":
        scheduleValidate(route.entryPath);
        return;
      case "ignored": {
        // Not a project member and doesn't look like an OpenAPI document: ignore it rather than
        // linting it as a broken standalone entry (avoids spurious "Missing required field
        // openapi" noise now that the client may sync every yaml/json/jsonc file).
        //
        // `routeDocument` already dropped `path` from `openStandaloneEntries` (it's no longer a
        // standalone entry), so cancel any debounced `validate` still pending for it — otherwise a
        // stale timer can fire after this transition and republish diagnostics onto a document the
        // server just decided to ignore — and clear every URI `validate` previously published for
        // this entry (not just `path` itself: a standalone entry can publish diagnostics onto
        // $ref'd fragment files too), mirroring what `onDidClose` does for a closed standalone entry.
        const timer = debounceTimers.get(path);
        if (timer) {
          clearTimeout(timer);
          debounceTimers.delete(path);
        }
        clearPublishedFor(path);
        // `clearPublishedFor` only sends a publish for `path` when a previous `validate` recorded
        // one (e.g. this document was a standalone entry before this edit); publish unconditionally
        // too, so the client always hears about this document's own diagnostics on this transition,
        // even the first time it's ever seen (never validated). Publishing the *merged* set (not a
        // blanket empty) keeps any contribution another entry's graph still has for this file.
        runner.republishFile(path);
        // It may still be a $ref'd fragment of one or more open standalone entries (see
        // `routeDocument`'s "ignored" case): re-validate those so their published diagnostics don't
        // go stale until the entry document itself is next edited. This also republishes the
        // fragment's own diagnostics (if any) as part of each dependent entry's graph, the same way
        // a project-member fragment's diagnostics ride along with its owning entry's validate.
        for (const entryPath of route.dependentStandaloneEntries ?? []) scheduleValidate(entryPath);
        return;
      }
    }
  }

  /**
   * External (on-disk) change to a watched non-config file — git checkout, codegen, another
   * process — reported by the client's workspace-scoped YAML/JSON watcher (issue #51). The server
   * filters by membership itself: only entries whose graph involves `path` are revalidated, and a
   * file that's currently open is skipped entirely (its content comes from the overlay buffer;
   * disk must never replace unsaved edits — the close handler reconciles with disk later).
   */
  async function handleWatchedFileChange(path: string, changeType: FileChangeType): Promise<void> {
    if (documents.get(toUri(path))) return;

    invalidateGraph(ctx, path);

    // Entries affected per the last-known graph membership (survives the invalidation above):
    // project entries and open standalone entries whose graph contained the file, plus the file
    // itself when it is a project entry.
    const projectEntries = [...ctx.projects.values()].flatMap((project) => project.entryPaths);
    const affected = new Set(findEntriesLastContaining(ctx, path, projectEntries));
    if (projectEntries.includes(path)) affected.add(path);
    for (const entryPath of findEntriesLastContaining(ctx, path, ctx.openStandaloneEntries)) affected.add(entryPath);

    if (changeType === FileChangeType.Created) {
      // A new file can change glob-expanded `entries` membership, so re-resolve projects whose
      // directory tree contains it; and it can satisfy a previously-unresolved `$ref` in *any*
      // graph (an unresolved target never made it into `lastGraphFiles`), so revalidate every
      // project entry rather than trying to guess which graphs wanted this file.
      for (const project of [...ctx.projects.values()]) {
        if (path.startsWith(project.configDir + sep)) await reloadProjectAtConfigPath(project.configPath);
      }
      for (const project of ctx.projects.values()) {
        for (const entryPath of project.entryPaths) affected.add(entryPath);
      }
    } else if (changeType === FileChangeType.Deleted && projectEntries.includes(path)) {
      // A deleted entry file shrinks project membership (declared entries get a warning, glob
      // matches drop out); reload so stale entries don't keep getting linted.
      for (const project of [...ctx.projects.values()]) {
        if (project.entryPaths.includes(path)) await reloadProjectAtConfigPath(project.configPath);
      }
    }

    // Reloads above may have changed which entries still exist; only revalidate live ones (a
    // dropped entry's diagnostics were already cleared by `reloadProjectAtConfigPath`).
    const liveEntries = new Set([...ctx.projects.values()].flatMap((project) => project.entryPaths));
    for (const entryPath of affected) {
      if (liveEntries.has(entryPath) || ctx.openStandaloneEntries.has(entryPath)) scheduleValidate(entryPath);
    }
  }

  /** Reconcile server state with a runtime workspace topology change. Added roots are scanned
   * directly because existing files are not guaranteed to produce watcher Created events;
   * projects no longer covered by any workspace root are unloaded and their diagnostics cleared. */
  async function handleWorkspaceFoldersChanged(event: {
    added: Array<{ uri: string }>;
    removed: Array<{ uri: string }>;
  }): Promise<void> {
    const addedRoots = event.added.map((folder) => pathResolve(URI.parse(folder.uri).fsPath));
    const removedRoots = event.removed.map((folder) => pathResolve(URI.parse(folder.uri).fsPath));
    const removedSet = new Set(removedRoots);
    workspaceRoots = [
      ...new Set([...workspaceRoots.map((root) => pathResolve(root)).filter((root) => !removedSet.has(root)), ...addedRoots]),
    ];
    ctx.workspaceRoots = workspaceRoots;
    ctx.upwardMissCache.clear();
    ctx.standaloneConfigCache.clear();

    const removedEntries = new Set<string>();
    for (const [configPath, project] of [...ctx.projects]) {
      const belongedToRemovedRoot = removedRoots.some((root) => isPathAtOrUnder(configPath, root));
      const stillInWorkspace = workspaceRoots.some((root) => isPathAtOrUnder(configPath, root));
      if (!belongedToRemovedRoot || stillInWorkspace) continue;

      ctx.projects.delete(configPath);
      publishConfigWarnings(configPath, []);
      for (const entryPath of project.entryPaths) removedEntries.add(entryPath);
    }

    for (const entryPath of removedEntries) {
      const timer = debounceTimers.get(entryPath);
      if (timer) {
        clearTimeout(timer);
        debounceTimers.delete(entryPath);
      }
      clearPublishedFor(entryPath);
      ctx.lastGraphFiles.delete(entryPath);
    }
    if (removedEntries.size > 0) {
      ctx.graphEpoch++;
      ctx.graphCache.clear();
    }

    const addedProjects = await scanWorkspaceRootsForProjects(ctx, addedRoots, false);
    for (const project of addedProjects) publishConfigWarnings(project.configPath, project.warnings);
    await publishAllProjects();

    // Topology changes can reroute already-open documents between project-member, standalone, and
    // ignored. Re-run the same routing used for normal document events against their overlay text.
    for (const document of documents.all()) {
      await handleDocumentEvent(toPath(document.uri), document.getText());
    }
  }

  // Last-resort net: a bug that somehow still slips past the per-site `runSafely` wrapping below
  // (e.g. in a handler added later without it) gets logged rather than crashing the process.
  process.on("unhandledRejection", (reason) => {
    connection.console.error(`[oasis] unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  });

  connection.onShutdown(() => {});
  connection.onExit(() => process.exit(0));

  connection.onInitialize((params) => {
    workspaceRoots = workspaceRootsFromInitialize(params);
    clientSupportsWorkspaceFolders = params.capabilities.workspace?.workspaceFolders === true;
    ctx.restrictProjectDiscoveryToWorkspaceRoots =
      clientSupportsWorkspaceFolders || (params.workspaceFolders !== undefined && params.workspaceFolders !== null);
    const options = params.initializationOptions as { configFiles?: unknown } | undefined;
    initConfigFiles = options?.configFiles;
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        definitionProvider: true,
        hoverProvider: true,
        completionProvider: { triggerCharacters: ['"', ":", "/", "#", "'", "$"] },
        documentSymbolProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        codeActionProvider: { codeActionKinds: ["quickfix", "refactor.extract", "refactor.inline"] },
        documentLinkProvider: {},
        workspaceSymbolProvider: true,
        workspace: {
          workspaceFolders: { supported: true, changeNotifications: true },
        },
      },
    };
  });

  connection.onInitialized(() => {
    runSafely(connection, "initializeProjects", initializeProjects);
    if (clientSupportsWorkspaceFolders) {
      connection.workspace.onDidChangeWorkspaceFolders((event) => {
        runSafely(connection, "handleWorkspaceFoldersChanged", () => handleWorkspaceFoldersChanged(event));
      });
    }
  });

  connection.onDidChangeWatchedFiles((params) => {
    for (const change of params.changes) {
      const path = toPath(change.uri);
      if (isConfigFilePath(path)) {
        runSafely(connection, "reloadProjectAtConfigPath", () => reloadProjectAtConfigPath(path));
      } else {
        runSafely(connection, "handleWatchedFileChange", () => handleWatchedFileChange(path, change.type));
      }
    }
  });

  documents.onDidOpen((event) => {
    runSafely(connection, "handleDocumentEvent", () => handleDocumentEvent(toPath(event.document.uri), event.document.getText()));
  });

  documents.onDidChangeContent((event) => {
    runSafely(connection, "handleDocumentEvent", () => handleDocumentEvent(toPath(event.document.uri), event.document.getText()));
  });

  /** Closing a document discards its in-memory buffer: from now on the overlay FS reads this path
   * from *disk*, so anything computed from the (possibly unsaved, now-discarded) buffer content
   * must be recomputed (issue #50). */
  async function handleDocumentClose(path: string): Promise<void> {
    const wasStandaloneEntry = ctx.openStandaloneEntries.has(path);
    invalidateGraph(ctx, path);
    ctx.openStandaloneEntries.delete(path);
    // Any validation still in flight for this entry was reading the just-discarded buffer; its
    // result must not land after the close (issue #49). Same for a still-pending debounce.
    runner.invalidateEntry(path);
    const timer = debounceTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      debounceTimers.delete(path);
    }

    // Closing an edited-but-unsaved config buffer must snap the project back to what the config
    // file on disk says (the overlay no longer covers this path, so this reload reads disk).
    if (isConfigFilePath(path)) {
      await reloadProjectAtConfigPath(path);
      return;
    }

    // A standalone entry's diagnostics only ever came from *this* document being open — once it
    // closes there's nothing left to refresh or clear them, so clear now (only this entry's
    // contribution; a sibling graph's diagnostics on shared files survive the merge).
    if (wasStandaloneEntry) clearPublishedFor(path);

    // The closed document may be a member of one or more project entry graphs, or a `$ref`'d
    // fragment of other open standalone entries, whose published diagnostics were computed from
    // the discarded buffer: revalidate those entries from the underlying FileSystem so unsaved
    // content stops being reflected in the Problems panel.
    const projectEntries = [...ctx.projects.values()].flatMap((project) => project.entryPaths);
    const affected = new Set(findEntriesLastContaining(ctx, path, projectEntries));
    if (projectEntries.includes(path)) affected.add(path);
    for (const entryPath of findEntriesLastContaining(ctx, path, ctx.openStandaloneEntries)) affected.add(entryPath);
    for (const entryPath of affected) await validate(entryPath);
  }

  documents.onDidClose((event) => {
    const uri = event.document.uri;
    runSafely(connection, "handleDocumentClose", async () => {
      // Close handling still publishes (e.g. clears a standalone entry's diagnostics) through
      // `toUri`, so drop the URI mapping only after it has fully settled.
      await handleDocumentClose(toPath(uri));
      forget(uri);
    });
  });

  connection.onDefinition(async (params) => {
    const path = toPath(params.textDocument.uri);
    const result = await getDefinition(ctx, { path, position: params.position });
    if (!result) return null;
    return { uri: toUri(result.targetPath), range: toLspRange(result.range) };
  });

  connection.onHover(async (params) => {
    const path = toPath(params.textDocument.uri);
    const result = await getHover(ctx, { path, position: params.position });
    if (!result) return null;
    return { contents: { kind: "markdown", value: result.contents } };
  });

  connection.onCompletion(async (params) => {
    const path = toPath(params.textDocument.uri);
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
    const path = toPath(params.textDocument.uri);
    const open = documents.get(params.textDocument.uri);
    const doc = open ? parseDocument(open.getText(), path) : undefined;
    if (!doc) return [];
    return getDocumentSymbols(doc).map(toLspSymbol);
  });

  connection.onReferences(async (params) => {
    const path = toPath(params.textDocument.uri);
    const results = await getReferences(ctx, {
      path,
      position: params.position,
      includeDeclaration: params.context.includeDeclaration,
    });
    return results.map((result) => ({ uri: toUri(result.filePath), range: toLspRange(result.range) }));
  });

  connection.onPrepareRename(async (params) => {
    const path = toPath(params.textDocument.uri);
    const result = await prepareRename(ctx, { path, position: params.position });
    if (!result) return null;
    return { range: toLspRange(result.range), placeholder: result.placeholder };
  });

  connection.onRenameRequest(async (params) => {
    const path = toPath(params.textDocument.uri);
    const edits = await renameComponent(ctx, { path, position: params.position, newName: params.newName });
    if (!edits) return null;
    return { changes: groupEditsByUri(edits, toUri) };
  });

  connection.onCodeAction(async (params) => {
    const path = toPath(params.textDocument.uri);
    const results = await getCodeActions(ctx, {
      path,
      position: params.range.start,
      diagnostics: params.context.diagnostics.map((d) => ({
        code: typeof d.code === "string" ? d.code : undefined,
        message: d.message,
        range: d.range,
      })),
    });
    return results.map(
      (result): LspCodeAction => ({
        title: result.title,
        kind: result.kind,
        diagnostics: result.diagnosticIndex !== undefined ? [params.context.diagnostics[result.diagnosticIndex]!] : undefined,
        isPreferred: result.isPreferred,
        edit: { changes: groupEditsByUri(result.edits, toUri) },
      }),
    );
  });

  connection.onDocumentLinks(async (params) => {
    const path = toPath(params.textDocument.uri);
    const links = await getDocumentLinks(ctx, { path });
    return links.map((link) => ({ range: toLspRange(link.range), target: toUri(link.targetPath) }));
  });

  connection.onWorkspaceSymbol(async (params): Promise<SymbolInformation[]> => {
    const results = await getWorkspaceSymbols(ctx, params.query);
    return results.map(
      (result): SymbolInformation => ({
        name: result.name,
        kind: WORKSPACE_SYMBOL_KIND_MAP[result.kind],
        containerName: result.containerName,
        location: { uri: toUri(result.filePath), range: toLspRange(result.range) },
      }),
    );
  });

  documents.listen(connection);
  connection.listen();
  return connection;
}
