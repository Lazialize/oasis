import * as vscode from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

// The oasis language server (`oasis lsp`) does not gate on languageId or inspect any
// initialization options — it treats *every* document it's asked to open as the entry point of
// its own OpenAPI workspace graph and lints it accordingly (see packages/server/src/connection.ts
// and packages/server/src/diagnostics.ts). A plain YAML/JSON file with no `openapi` key would
// still be parsed and linted, and would immediately fail the `structure-required-fields` /
// `structure-openapi-version` rules with a "Missing required field \"openapi\"" diagnostic. So the
// server itself will not no-op on non-OpenAPI files.
//
// To honor DESIGN.md's "activates on YAML/JSON files that look like OpenAPI" behavior, the guard
// lives on the client: the document selector matches yaml/json/jsonc broadly (so the client can
// activate and inspect content), but a `documentSelector` `pattern`-less approach isn't enough by
// itself, so we additionally filter with middleware that only lets requests through — and only
// calls `didOpen`/`didChange` — for documents whose text looks like an OpenAPI document.
const OPENAPI_YAML_KEY = /^\s*(['"]?)openapi\1\s*:/m;
const OPENAPI_JSON_KEY = /"openapi"\s*:/;

function looksLikeOpenApi(document: vscode.TextDocument): boolean {
  if (!["yaml", "json", "jsonc"].includes(document.languageId)) return false;
  const text = document.getText();
  return OPENAPI_YAML_KEY.test(text) || OPENAPI_JSON_KEY.test(text);
}

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel | undefined;

// Tracks which documents we've actually forwarded a didOpen for, so that a document which starts
// out not looking like OpenAPI (e.g. a brand-new empty YAML file) still gets synced once the user
// types an `openapi:` key into it, rather than being silently ignored for the rest of its life.
const syncedDocuments = new Set<string>();

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
  return {
    documentSelector: ["yaml", "json", "jsonc"],
    outputChannel,
    middleware: {
      didOpen: async (document, next) => {
        if (!looksLikeOpenApi(document)) return;
        syncedDocuments.add(document.uri.toString());
        await next(document);
      },
      didChange: async (event, next) => {
        const key = event.document.uri.toString();
        if (!looksLikeOpenApi(event.document)) return;
        // Document started out not looking like OpenAPI (so didOpen was suppressed) but now does
        // — sync it in via a synthetic didOpen before forwarding the change.
        if (!syncedDocuments.has(key)) {
          syncedDocuments.add(key);
          await client?.sendNotification("textDocument/didOpen", {
            textDocument: {
              uri: event.document.uri.toString(),
              languageId: event.document.languageId,
              version: event.document.version,
              text: event.document.getText(),
            },
          });
        }
        await next(event);
      },
      didClose: async (document, next) => {
        const key = document.uri.toString();
        if (!syncedDocuments.has(key)) return;
        syncedDocuments.delete(key);
        await next(document);
      },
      didSave: async (document, next) => {
        if (!syncedDocuments.has(document.uri.toString())) return;
        await next(document);
      },
      provideCompletionItem: async (document, position, context, token, next) => {
        if (!looksLikeOpenApi(document)) return undefined;
        return next(document, position, context, token);
      },
      provideHover: async (document, position, token, next) => {
        if (!looksLikeOpenApi(document)) return undefined;
        return next(document, position, token);
      },
      provideDefinition: async (document, position, token, next) => {
        if (!looksLikeOpenApi(document)) return undefined;
        return next(document, position, token);
      },
      provideDocumentSymbols: async (document, token, next) => {
        if (!looksLikeOpenApi(document)) return undefined;
        return next(document, token);
      },
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
  syncedDocuments.clear();
  if (!client) return;
  const toStop = client;
  client = undefined;
  await toStop.stop();
}

async function restartClient(): Promise<void> {
  await stopClient();
  await startClient();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel("Oasis Language Server");
  context.subscriptions.push(outputChannel);

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

  await startClient();
}

export async function deactivate(): Promise<void> {
  await stopClient();
}
