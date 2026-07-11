import { runLintCommand } from "./commands/lint.ts";

const HELP = `oasis - OpenAPI toolkit (lint / bundle / lsp)

Usage:
  oasis lint <entry...> [--config path] [--format pretty|json]
  oasis bundle <entry> [-o out] [--format yaml|json]   (not yet implemented)
  oasis lsp                                            (not yet implemented)

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
    case "lint":
      return runLintCommand(rest, io);
    case undefined:
    case "-h":
    case "--help":
      io.stdout(HELP);
      return 0;
    case "bundle":
    case "lsp":
      io.stderr(`oasis: "${command}" is not implemented yet.\n`);
      return 2;
    default:
      io.stderr(`oasis: unknown command "${command}"\n\n`);
      io.stdout(HELP);
      return 2;
  }
}
