import * as vscode from "vscode";
import {
  DidChangeWatchedFilesNotification,
  FileChangeType,
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { looksLikeOpenApiText } from "./openapi-guard.ts";
import { createDocumentProviderGuards } from "./provider-guards.ts";
import { refreshProjectMode } from "./project-mode.ts";
import { createDocumentSyncGuards } from "./sync-guards.ts";

const CONFIG_FILE_NAME = "oasis.config.jsonc";

// The oasis language server (`oasis lsp`) does not gate on languageId. Without project mode, it
// treats every document it's asked to open as the entry point of its own OpenAPI workspace graph
// and lints it accordingly (see packages/server/src/connection.ts and
// packages/server/src/diagnostics.ts). A plain YAML/JSON file with no `openapi` key would still be
// parsed and linted, and would immediately fail the `structure-required-fields` /
// `structure-openapi-version` rules with a "Missing required field \"openapi\"" diagnostic.
//
// To honor DESIGN.md's "activates on YAML/JSON files that look like OpenAPI" behavior, the guard
// normally lives on the client: the document selector matches yaml/json/jsonc broadly (so the
// client can activate and inspect content), but middleware only lets requests through — and only
// calls `didOpen`/`didChange` — for documents whose text looks like an OpenAPI document.
//
// "Project mode" changes this: when the workspace contains an `oasis.config.jsonc`, the server
// itself resolves project-entry graphs and decides membership for every synced document (see
// `findOwningEntry`/`routeDocument` in packages/server/src), silently ignoring files that are
// neither a project member nor look like OpenAPI on their own. In that case the client relaxes
// its guard and syncs every yaml/json/jsonc document (including fragment files like a Path Item
// file with no `openapi:` key, which previously got no LSP features at all when opened directly).
//
// The guard lives in ./openapi-guard.ts, which mirrors packages/server/src/openapi-guard.ts
// (root-aware detection, issue #52; comment/escape/prefix tokenization, issue #122). This
// extension bundles with npm/esbuild and cannot import from that Bun workspace package, so the
// implementation is duplicated — keep the two in sync (both sites carry this note).

/** Whether this document should be synced to the server at all, per the current guard mode. */
function shouldSync(document: vscode.TextDocument): boolean {
  if (!["yaml", "json", "jsonc"].includes(document.languageId)) return false;
  if (projectModeActive) return true; // server decides membership; sync everything.
  return looksLikeOpenApiText(document.getText());
}

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let configWatcher: vscode.FileSystemWatcher | undefined;

/** Set once at activation if any workspace folder contains `oasis.config.jsonc` (deep scan). */
let projectModeActive = false;

/**
 * Absolute paths of every `oasis.config.jsonc` found by the deep scan, passed to the server as
 * `initializationOptions.configFiles` so it can eagerly load projects that live in a subdirectory
 * rather than at a workspace folder root — the server's own root-of-workspace-folder scan alone
 * would miss those (see `scanWorkspaceRootsForProjects` in packages/server/src/project.ts). Capped
 * to keep initialize fast/bounded in pathological workspaces; the server's independent upward
 * discovery (walking up from an opened document) is the fallback for anything beyond the cap.
 */
const MAX_CONFIG_FILES = 20;
let discoveredConfigFiles: string[] = [];

async function detectProjectMode(): Promise<boolean> {
  const found = await vscode.workspace.findFiles(`**/${CONFIG_FILE_NAME}`, "**/node_modules/**", MAX_CONFIG_FILES);
  discoveredConfigFiles = found.map((uri) => uri.fsPath);
  return found.length > 0;
}

/**
 * Tracks which documents are currently synced to the server and serializes every transition
 * (middleware traffic and reconciliation alike) per document, so a false-to-true or true-to-false
 * content transition always produces exactly one didOpen/didClose and can't race a project-mode
 * resync for the same URI (issue #112). See sync-guards.ts for the state machine itself.
 */
const documentSyncGuards = createDocumentSyncGuards<vscode.TextDocument, vscode.TextDocumentChangeEvent>({
  shouldSync,
  getUri: (document) => document.uri.toString(),
  sendDidOpen: async (document) => {
    await client?.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: document.uri.toString(),
        languageId: document.languageId,
        version: document.version,
        text: document.getText(),
      },
    });
  },
  sendDidClose: async (uri) => {
    await client?.sendNotification("textDocument/didClose", { textDocument: { uri } });
  },
});

/**
 * Reconcile every open document with the current synchronization predicate (`shouldSync`) by
 * sending the missing didOpen/didClose notifications (issue #58). Needed whenever
 * `projectModeActive` flips, because the predicate changes retroactively for documents that are
 * *already* open:
 * - standalone -> project: fragment files without a root `openapi` key were never synced (no
 *   didOpen was forwarded); without a synthetic didOpen they stay invisible to the server until
 *   edited or reopened.
 * - project -> standalone: previously-synced non-OpenAPI documents must be closed on the server,
 *   otherwise their overlay buffers and diagnostics linger while subsequent changes are suppressed
 *   by the middleware, leaving them permanently stale.
 */
async function resyncOpenDocuments(): Promise<void> {
  if (!client) return;
  for (const document of vscode.workspace.textDocuments) {
    if (!["yaml", "json", "jsonc"].includes(document.languageId)) continue;
    await documentSyncGuards.reconcileDocument(document);
  }
}

/** Flip `projectModeActive` and, on an actual transition, resync already-open documents against
 * the new predicate before normal middleware traffic relies on it. */
function setProjectMode(active: boolean): void {
  if (projectModeActive === active) return;
  projectModeActive = active;
  void resyncOpenDocuments();
}

/** Re-scan the current set of workspace folders and await reconciliation of already-open buffers.
 * Existing configs in an added folder do not reliably produce file-watcher Created events. */
async function refreshWorkspaceProjectMode(): Promise<void> {
  await refreshProjectMode({
    isActive: () => projectModeActive,
    detect: detectProjectMode,
    getConfigFiles: () => discoveredConfigFiles,
    notifyConfigFilesAdded: async (paths) => {
      await client?.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: paths.map((path) => ({ uri: vscode.Uri.file(path).toString(), type: FileChangeType.Created })),
      });
    },
    setActive: (active) => {
      projectModeActive = active;
    },
    reconcileOpenDocuments: resyncOpenDocuments,
  });
}

function buildServerOptions(): ServerOptions {
  const config = vscode.workspace.getConfiguration("oasis");
  const command = config.get<string>("server.path", "oasis");
  const args = config.get<string[]>("server.args", ["lsp"]);
  return {
    run: { command, args, transport: TransportKind.stdio },
    debug: { command, args, transport: TransportKind.stdio },
  };
}

function buildClientOptions(): LanguageClientOptions {
  const documentProviderGuards = createDocumentProviderGuards(shouldSync);
  return {
    documentSelector: ["yaml", "json", "jsonc"],
    outputChannel,
    initializationOptions: { configFiles: discoveredConfigFiles },
    middleware: {
      didOpen: async (document, next) => documentSyncGuards.didOpen(document, next),
      didChange: async (event, next) => documentSyncGuards.didChange(event, next),
      didClose: async (document, next) => documentSyncGuards.didClose(document, next),
      didSave: async (document, next) => {
        if (!documentSyncGuards.isSynced(document.uri.toString())) return;
        await next(document);
      },
      provideCompletionItem: async (document, position, context, token, next) => {
        if (!shouldSync(document)) return undefined;
        return next(document, position, context, token);
      },
      provideHover: async (document, position, token, next) => {
        if (!shouldSync(document)) return undefined;
        return next(document, position, token);
      },
      provideDefinition: async (document, position, token, next) => {
        if (!shouldSync(document)) return undefined;
        return next(document, position, token);
      },
      provideDocumentSymbols: async (document, token, next) => {
        if (!shouldSync(document)) return undefined;
        return next(document, token);
      },
      provideReferences: async (document, position, context, token, next) =>
        documentProviderGuards.provideReferences(document, (currentDocument) =>
          next(currentDocument, position, context, token),
        ),
      prepareRename: async (document, position, token, next) =>
        documentProviderGuards.prepareRename(document, (currentDocument) => next(currentDocument, position, token)),
      provideRenameEdits: async (document, position, newName, token, next) =>
        documentProviderGuards.provideRenameEdits(document, (currentDocument) =>
          next(currentDocument, position, newName, token),
        ),
      provideCodeActions: async (document, range, context, token, next) =>
        documentProviderGuards.provideCodeActions(document, (currentDocument) =>
          next(currentDocument, range, context, token),
        ),
      provideDocumentLinks: async (document, token, next) =>
        documentProviderGuards.provideDocumentLinks(document, (currentDocument) => next(currentDocument, token)),
    },
  };
}

async function startClient(): Promise<void> {
  const serverOptions = buildServerOptions();
  const clientOptions = buildClientOptions();

  client = new LanguageClient("oasis", "Oasis Language Server", serverOptions, clientOptions);

  try {
    await client.start();
  } catch (error) {
    const config = vscode.workspace.getConfiguration("oasis");
    const command = config.get<string>("server.path", "oasis");
    const message =
      error instanceof Error && /ENOENT|not found|spawn/i.test(error.message)
        ? `Oasis: could not launch the language server ("${command}"). Check the "oasis.server.path" setting, or install the oasis CLI and ensure it's on your PATH.`
        : `Oasis: failed to start the language server: ${error instanceof Error ? error.message : String(error)}`;
    void vscode.window.showErrorMessage(message);
    client = undefined;
  }
}

async function stopClient(): Promise<void> {
  documentSyncGuards.reset();
  if (!client) return;
  const toStop = client;
  client = undefined;
  await toStop.stop();
}

async function restartClient(): Promise<void> {
  await stopClient();
  await startClient();
}

/**
 * Notify the server about `oasis.config.jsonc` edits/creation/deletion via
 * `workspace/didChangeWatchedFiles`, since the server needs to reload project entries and re-lint
 * when the config changes (see `loadProjectConfig`/`isConfigFilePath` in packages/server/src). The
 * server doesn't dynamically register file watchers, so this watcher — and forwarding it —
 * belongs to the client.
 */
function registerConfigWatcher(context: vscode.ExtensionContext): void {
  configWatcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_FILE_NAME}`);
  context.subscriptions.push(configWatcher);

  const notify = (uri: vscode.Uri, type: FileChangeType): void => {
    void client?.sendNotification(DidChangeWatchedFilesNotification.type, {
      changes: [{ uri: uri.toString(), type }],
    });
  };

  context.subscriptions.push(
    configWatcher.onDidChange((uri) => notify(uri, FileChangeType.Changed)),
    configWatcher.onDidCreate((uri) => {
      if (!discoveredConfigFiles.includes(uri.fsPath)) discoveredConfigFiles.push(uri.fsPath);
      // Tell the server about the new config first (so it loads the project), then flip the mode
      // and resync already-open documents against the relaxed predicate (issue #58). The order
      // isn't load-bearing — the server's upward discovery also finds the config when a fragment's
      // didOpen arrives first — but this way the common case avoids that extra walk.
      notify(uri, FileChangeType.Created);
      setProjectMode(true);
    }),
    configWatcher.onDidDelete((uri) => {
      notify(uri, FileChangeType.Deleted);
      discoveredConfigFiles = discoveredConfigFiles.filter((path) => path !== uri.fsPath);
      // Another config may still exist elsewhere in the workspace; only leave project mode (and
      // close now-unsyncable documents on the server, issue #58) when none remain.
      void detectProjectMode().then((active) => {
        setProjectMode(active);
      });
    }),
  );
}

/**
 * Forward external (on-disk) changes to YAML/JSON files so the server can refresh diagnostics for
 * *closed* project files too — a git checkout, codegen run, or another process rewriting an entry
 * or `$ref`'d fragment otherwise goes unnoticed, since document sync only covers open buffers. The
 * watcher is deliberately workspace-scoped and unfiltered: the server does its own membership
 * filtering (only files belonging to a loaded entry graph trigger revalidation, and open documents
 * are skipped so a disk change never replaces unsaved buffer content) — see
 * `handleWatchedFileChange` in packages/server/src/connection.ts.
 */
function registerProjectFileWatcher(context: vscode.ExtensionContext): void {
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.{yaml,yml,json}");
  context.subscriptions.push(watcher);

  const notify = (uri: vscode.Uri, type: FileChangeType): void => {
    void client?.sendNotification(DidChangeWatchedFilesNotification.type, {
      changes: [{ uri: uri.toString(), type }],
    });
  };

  context.subscriptions.push(
    watcher.onDidChange((uri) => notify(uri, FileChangeType.Changed)),
    watcher.onDidCreate((uri) => notify(uri, FileChangeType.Created)),
    watcher.onDidDelete((uri) => notify(uri, FileChangeType.Deleted)),
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel("Oasis Language Server");
  context.subscriptions.push(outputChannel);

  projectModeActive = await detectProjectMode();
  registerConfigWatcher(context);
  registerProjectFileWatcher(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("oasis.restartServer", async () => {
      await restartClient();
      void vscode.window.showInformationMessage("Oasis: language server restarted.");
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("oasis.server")) {
        void restartClient();
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refreshWorkspaceProjectMode();
    }),
  );

  await startClient();
}

export async function deactivate(): Promise<void> {
  await stopClient();
}
