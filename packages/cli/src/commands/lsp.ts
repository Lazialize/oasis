import { runLspServer } from "@oasis/server";
import { hasHelpFlag } from "../args.ts";

export interface RunLspOptions {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const LSP_HELP = `oasis lsp

Start the Oasis language server over stdio (LSP). Intended to be launched by an editor/LSP client,
not run interactively. Takes no arguments.

Options:
  -h, --help    Show this help message
`;

/** `oasis lsp`: start the language server on stdio. */
export async function runLspCommand(args: string[], io: RunLspOptions): Promise<number> {
  if (hasHelpFlag(args)) {
    io.stdout(LSP_HELP);
    return 0;
  }
  if (args.length > 0) {
    io.stderr(`oasis lsp: unexpected argument "${args[0]}" (lsp takes no arguments)\n`);
    return 2;
  }

  runLspServer();
  // The server lives for the lifetime of the stdio connection; keep the process running
  // until the client sends `exit` (handled inside runLspServer, which calls process.exit).
  return new Promise<number>(() => {});
}
