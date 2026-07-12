import { runLspServer } from "@oasis/server";
import { runBundleCommand } from "./commands/bundle.ts";
import { runInitCommand } from "./commands/init.ts";
import { runLintCommand } from "./commands/lint.ts";

const HELP = `oasis - OpenAPI toolkit (lint / bundle / lsp)

Usage:
  oasis init                                           scaffold an oasis.config.jsonc here
  oasis lint [entry...] [--config path] [--format pretty|json]
  oasis bundle <entry> [-o|--out path] [--format yaml|json]
  oasis lsp                                            start the LSP server on stdio

With no entry given, \`oasis lint\` discovers \`oasis.config.jsonc\` (upward from the working
directory, or via --config) and lints every document listed in its "entries".

Options:
  -h, --help    Show this help message
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** Dispatch a parsed argv (excluding the node/bun/script prefix) to a subcommand. Returns the process exit code. */
export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case "init":
      return runInitCommand(rest, io);
    case "lint":
      return runLintCommand(rest, io);
    case "bundle":
      return runBundleCommand(rest, io);
    case undefined:
    case "-h":
    case "--help":
      io.stdout(HELP);
      return 0;
    case "lsp":
      runLspServer();
      // The server lives for the lifetime of the stdio connection; keep the process running
      // until the client sends `exit` (handled inside runLspServer, which calls process.exit).
      return new Promise<number>(() => {});
    default:
      io.stderr(`oasis: unknown command "${command}"\n\n`);
      io.stdout(HELP);
      return 2;
  }
}
