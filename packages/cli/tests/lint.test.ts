import { describe, expect, test } from "bun:test";

const fixturesRoot = `${import.meta.dir}/fixtures`;
const cliEntry = `${import.meta.dir}/../src/index.ts`;

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", cliEntry, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("oasis lint CLI", () => {
  test("exits 0 and prints a clean message for a valid document", async () => {
    const result = await runCli(["lint", `${fixturesRoot}/valid.yaml`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No lint issues found.");
  });

  test("exits 1 and prints a pretty-formatted diagnostic for an invalid document", async () => {
    const result = await runCli(["lint", `${fixturesRoot}/invalid.yaml`]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("invalid.yaml");
    expect(result.stdout).toContain("operation-operationId");
    expect(result.stdout).toMatch(/\d+ errors?, \d+ warnings?/);
  });

  test("--format json produces a stable, machine-readable shape", async () => {
    const result = await runCli(["lint", `${fixturesRoot}/invalid.yaml`, "--format", "json"]);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(Array.isArray(report.diagnostics)).toBe(true);
    expect(report.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(report.diagnostics[0]).toMatchObject({
      rule: "operation-operationId",
      severity: "error",
    });
    expect(report.summary).toMatchObject({ errors: 1 });
  });

  test("--config overrides rule severity and can turn exit code to 0", async () => {
    const result = await runCli([
      "lint",
      `${fixturesRoot}/invalid.yaml`,
      "--config",
      `${fixturesRoot}/oasis.config.jsonc`,
      "--format",
      "json",
    ]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.diagnostics.some((d: { rule: string }) => d.rule === "operation-operationId")).toBe(false);
  });

  test("exits 2 on usage error (no entry given)", async () => {
    const result = await runCli(["lint"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("entry file");
  });

  test("exits 2 on a bad --format value", async () => {
    const result = await runCli(["lint", `${fixturesRoot}/valid.yaml`, "--format", "xml"]);
    expect(result.exitCode).toBe(2);
  });

  test("--help prints usage and exits 0", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });
});
