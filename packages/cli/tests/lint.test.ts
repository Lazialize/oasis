import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixturesRoot = `${import.meta.dir}/fixtures`;
const cliEntry = `${import.meta.dir}/../src/index.ts`;

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], options: { cwd?: string } = {}): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", cliEntry, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: options.cwd,
  });
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
    expect(result.stdout).toContain("operation/operation-id");
    expect(result.stdout).toMatch(/\d+ errors?, \d+ warnings?/);
  });

  test("--format json produces a stable, machine-readable shape", async () => {
    const result = await runCli(["lint", `${fixturesRoot}/invalid.yaml`, "--format", "json"]);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(Array.isArray(report.diagnostics)).toBe(true);
    expect(report.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(report.diagnostics[0]).toMatchObject({
      rule: "operation/operation-id",
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
    expect(report.diagnostics.some((d: { rule: string }) => d.rule === "operation/operation-id")).toBe(false);
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

  test("exits 2 when --format has no value", async () => {
    const result = await runCli(["lint", `${fixturesRoot}/valid.yaml`, "--format"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("requires a value");
  });

  test("--help prints usage and exits 0", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  test("a missing entry file is reported as an error diagnostic, not silently exit 0", async () => {
    const result = await runCli(["lint", "/does/not/exist.yaml", "--format", "json"]);
    const report = JSON.parse(result.stdout);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({ rule: "refs/no-unresolved", severity: "error" });
    expect(report.diagnostics[0].message).toContain("exist.yaml");
    expect(report.summary).toMatchObject({ errors: 1 });
    expect(result.exitCode).toBe(1);
  });

  test("exits 2 on a single-dash unknown flag (not silently treated as an entry path)", async () => {
    const result = await runCli(["lint", "-format", "json"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Unknown flag "-format"');
  });

  test("`--` allows linting an entry whose name starts with a dash", async () => {
    const result = await runCli(["lint", "--", `${fixturesRoot}/-weird.yaml`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No lint issues found.");
  });

  test("`--` protects a positional entry literally named --help from being read as the help flag (#31)", async () => {
    const result = await runCli(["lint", "--", "--help"]);
    expect(result.stdout).not.toContain("Options:");
    // Treated as an entry path (which doesn't exist) rather than the help flag.
    expect(result.exitCode).toBe(1);
    expect(result.stdout || result.stderr).toContain("--help");
  });
});

describe("oasis lint (no args, config entries)", () => {
  const configLintRoot = `${fixturesRoot}/config-lint`;

  test("lints every entry in the discovered config, exits 1 on findings", async () => {
    const result = await runCli(["lint"], { cwd: configLintRoot });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("invalid.yaml");
    expect(result.stdout).toContain("operation/operation-id");
    expect(result.stdout).toMatch(/\d+ errors?, \d+ warnings?/);
  });

  test("discovers the config upward from a subdirectory", async () => {
    const result = await runCli(["lint"], { cwd: `${configLintRoot}/nested` });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("invalid.yaml");
  });

  test("--config points at a config elsewhere", async () => {
    const result = await runCli(["lint", "--config", `${configLintRoot}/oasis.config.jsonc`]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("invalid.yaml");
  });

  test("a missing entry surfaces as a diagnostic warning while the other entry still lints", async () => {
    const result = await runCli(["lint"], { cwd: configLintRoot });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("missing.yaml");
    expect(result.stdout).toContain("not found");
    expect(result.stdout).toContain("invalid.yaml");
  });

  test("--format json produces the same shape as multi-entry lint, including the missing-entry warning", async () => {
    const result = await runCli(["lint", "--format", "json"], { cwd: configLintRoot });
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(Array.isArray(report.diagnostics)).toBe(true);
    expect(report.diagnostics.some((d: { rule: string }) => d.rule === "operation/operation-id")).toBe(true);
    const configWarning = report.diagnostics.find((d: { rule: string }) => d.rule === "oasis/config");
    expect(configWarning).toMatchObject({ severity: "warn" });
    expect(configWarning.message).toContain("missing.yaml");
    expect(report.summary).toMatchObject({ errors: 1, warnings: 1 });
  });

  test("exits 2 with a helpful message when no args are given and no config is found", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "oasis-cli-no-config-"));
    const result = await runCli(["lint"], { cwd: emptyDir });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("entry file");
    expect(result.stderr).toContain("oasis.config.jsonc");
  });

  test("exits 2 with a helpful message when the config has no entries", async () => {
    const result = await runCli(["lint", "--config", `${fixturesRoot}/oasis.config.jsonc`]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("entries");
  });

  test("exits 2 when every declared entry is missing", async () => {
    const result = await runCli(["lint"], { cwd: `${fixturesRoot}/config-lint-all-missing` });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("missing-a.yaml");
    expect(result.stderr).toContain("missing-b.yaml");
  });

  test("glob entries expand to every matching file relative to the config directory", async () => {
    // specs/one.yaml is missing an operationId (error); specs/two.yaml is clean but must still be
    // linted — both are matched by the "specs/*.yaml" glob entry.
    const result = await runCli(["lint", "--format", "json"], { cwd: `${fixturesRoot}/config-lint-glob` });
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.diagnostics.some((d: { rule: string }) => d.rule === "operation/operation-id")).toBe(true);
    expect(report.diagnostics.some((d: { rule: string }) => d.rule === "oasis/config")).toBe(false); // no zero-match warning
    expect(result.stdout).toContain("one.yaml");
  });
});
