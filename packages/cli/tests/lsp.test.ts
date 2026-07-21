import { describe, expect, test } from "bun:test";

const cliEntry = `${import.meta.dir}/../src/index.ts`;

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", cliEntry, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("oasis lsp CLI", () => {
  test("--help prints usage and exits 0", async () => {
    const result = await runCli(["lsp", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("oasis lsp");
    expect(result.stdout).toContain("--help");
    expect(result.stdout).toContain("Start the Oasis language server");
  });

  test("-h prints usage and exits 0", async () => {
    const result = await runCli(["lsp", "-h"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("oasis lsp");
    expect(result.stdout).toContain("--help");
  });

  test("rejects unexpected arguments with exit 2", async () => {
    const result = await runCli(["lsp", "--definitely-not-a-real-flag"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unexpected argument");
    expect(result.stderr).toContain("definitely-not-a-real-flag");
  });

  test("rejects positional arguments with exit 2", async () => {
    const result = await runCli(["lsp", "extra"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unexpected argument");
    expect(result.stderr).toContain("extra");
  });

  test("--help documents the accepted --stdio transport flag", async () => {
    const result = await runCli(["lsp", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--stdio");
  });

  // vscode-languageclient (and Neovim/Helix/Emacs by the same convention) appends `--stdio` to the
  // launch command for a stdio-transport server. The server must accept it instead of exiting 2,
  // otherwise it dies the moment such a client starts it. We can't easily assert "server started"
  // without driving the LSP handshake (see binary.test.ts), so here we assert the negative: it does
  // not exit 2 with the "unexpected argument" rejection. The process runs until stdin closes.
  test("accepts a bare --stdio transport flag without rejecting it", async () => {
    const proc = Bun.spawn(["bun", "run", cliEntry, "lsp", "--stdio"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });
    // Close stdin so the server's stdio reader hits EOF and the process can exit on its own.
    proc.stdin.end();
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(stderr).not.toContain("unexpected argument");
    expect(exitCode).not.toBe(2);
  });
});
