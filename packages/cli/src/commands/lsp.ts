import { runLspServer } from "@oasis/server";
import { hasHelpFlag } from "../args.ts";

export interface RunLspOptions {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const LSP_HELP = `oasis lsp

Start the Oasis language server over stdio (LSP). Intended to be launched by an editor/LSP client,
not run interactively.

Options:
  --stdio       Use stdio for the LSP transport (the default and only transport; accepted for
                compatibility with clients that pass it explicitly, e.g. vscode-languageclient's
                stdio transport). No effect.
  -h, --help    Show this help message
`;

/**
 * `oasis lsp`: start the language server on stdio.
 *
 * Accepts a bare `--stdio` flag and silently ignores it: LSP clients that declare the stdio
 * transport append `--stdio` to the launch command by convention (e.g. vscode-languageclient's
 * `TransportKind.stdio`, and the same convention in Neovim/Helix/Emacs configs). The server always
 * speaks LSP over stdio, so the flag is a no-op — but rejecting it as "unexpected" would kill the
 * server the moment such a client launched it. Any other argument is still an error.
 */
export async function runLspCommand(args: string[], io: RunLspOptions): Promise<number> {
  if (hasHelpFlag(args)) {
    io.stdout(LSP_HELP);
    return 0;
  }
  const unexpected = args.find((arg) => arg !== "--stdio");
  if (unexpected !== undefined) {
    io.stderr(`oasis lsp: unexpected argument "${unexpected}" (lsp takes no arguments)\n`);
    return 2;
  }

  runLspServer();
  // The server lives for the lifetime of the stdio connection; keep the process running
  // until the client sends `exit` (handled inside runLspServer, which calls process.exit).
  return new Promise<number>(() => {});
}
