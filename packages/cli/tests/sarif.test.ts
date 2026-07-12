import { describe, expect, test } from "bun:test";
import type { LintDiagnostic } from "@oasis/linter";
import { toSarifLog } from "../src/render/sarif.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;
const cliEntry = `${import.meta.dir}/../src/index.ts`;

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface SarifRun {
  tool: { driver: { name: string; informationUri: string; version: string; rules: Array<{ id: string; shortDescription: { text: string } }> } };
  results: Array<{
    ruleId: string;
    level: string;
    message: { text: string };
    locations: Array<{ physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number; startColumn: number; endLine: number; endColumn: number } } }>;
  }>;
}

interface SarifLog {
  $schema: string;
  version: string;
  runs: SarifRun[];
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

describe("oasis lint --format sarif", () => {
  test("produces a valid SARIF 2.1.0 log for a clean document", async () => {
    const result = await runCli(["lint", `${fixturesRoot}/valid.yaml`, "--format", "sarif"]);
    expect(result.exitCode).toBe(0);
    const log = JSON.parse(result.stdout) as SarifLog;
    expect(log.$schema).toBe("https://json.schemastore.org/sarif-2.1.0.json");
    expect(log.version).toBe("2.1.0");
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]?.tool.driver.name).toBe("oasis");
    expect(log.runs[0]?.tool.driver.informationUri).toBe("https://github.com/Lazialize/oasis");
    expect(log.runs[0]?.tool.driver.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(log.runs[0]?.tool.driver.rules).toEqual([]);
    expect(log.runs[0]?.results).toEqual([]);
  });

  test("maps error/warning/info severities to SARIF levels", async () => {
    const result = await runCli(["lint", `${fixturesRoot}/invalid.yaml`, "--format", "sarif"]);
    expect(result.exitCode).toBe(1);
    const log = JSON.parse(result.stdout) as SarifLog;
    const result0 = log.runs[0]?.results[0];
    expect(result0).toMatchObject({ ruleId: "operation/operation-id", level: "error" });
  });

  test("dedupes the rules array to rules that actually produced results, across a combined multi-entry run", async () => {
    const result = await runCli([
      "lint",
      `${fixturesRoot}/sarif/entry.yaml`,
      `${fixturesRoot}/sarif/second.yaml`,
      "--format",
      "sarif",
    ]);
    expect(result.exitCode).toBe(1);
    const log = JSON.parse(result.stdout) as SarifLog;

    // Single combined run for both entries.
    expect(log.runs).toHaveLength(1);

    // "operation/operation-id" fires for both entry.yaml and second.yaml but appears once in rules.
    const ruleIds = log.runs[0]?.tool.driver.rules.map((r) => r.id) ?? [];
    expect(ruleIds.filter((id) => id === "operation/operation-id")).toHaveLength(1);
    expect(ruleIds).toContain("structure/schema-nullable");
    for (const rule of log.runs[0]?.tool.driver.rules ?? []) {
      expect(rule.shortDescription.text).toBe(rule.id);
    }

    const operationIdResults = log.runs[0]?.results.filter((r) => r.ruleId === "operation/operation-id") ?? [];
    expect(operationIdResults).toHaveLength(2);
  });

  test("attributes a cross-file ($ref'd) diagnostic to the referenced file with a repo-relative, forward-slashed URI", async () => {
    const result = await runCli(
      ["lint", "tests/fixtures/sarif/entry.yaml", "--format", "sarif"],
      { cwd: `${import.meta.dir}/..` },
    );
    expect(result.exitCode).toBe(1);
    const log = JSON.parse(result.stdout) as SarifLog;
    const schemaResult = log.runs[0]?.results.find((r) => r.ruleId === "structure/schema-nullable");
    expect(schemaResult).toBeDefined();
    const uri = schemaResult?.locations[0]?.physicalLocation.artifactLocation.uri;
    expect(uri).toBe("tests/fixtures/sarif/shared.yaml");
    expect(uri).not.toContain("\\");
  });

  test("converts 0-based internal ranges to 1-based SARIF regions", async () => {
    const result = await runCli(["lint", `${fixturesRoot}/invalid.yaml`, "--format", "json"]);
    const jsonReport = JSON.parse(result.stdout);
    const jsonDiagnostic = jsonReport.diagnostics[0];

    const sarifResult = await runCli(["lint", `${fixturesRoot}/invalid.yaml`, "--format", "sarif"]);
    const log = JSON.parse(sarifResult.stdout) as SarifLog;
    const region = log.runs[0]?.results[0]?.locations[0]?.physicalLocation.region;

    expect(region?.startLine).toBe(jsonDiagnostic.range.start.line + 1);
    expect(region?.startColumn).toBe(jsonDiagnostic.range.start.character + 1);
    expect(region?.endLine).toBe(jsonDiagnostic.range.end.line + 1);
    expect(region?.endColumn).toBe(jsonDiagnostic.range.end.character + 1);
  });

  test("exit code matches other formats (1 on error findings, 0 clean)", async () => {
    const dirty = await runCli(["lint", `${fixturesRoot}/invalid.yaml`, "--format", "sarif"]);
    expect(dirty.exitCode).toBe(1);
    const clean = await runCli(["lint", `${fixturesRoot}/valid.yaml`, "--format", "sarif"]);
    expect(clean.exitCode).toBe(0);
  });

  test("rejects an unknown --format value", async () => {
    const result = await runCli(["lint", `${fixturesRoot}/valid.yaml`, "--format", "xml"]);
    expect(result.exitCode).toBe(2);
  });
});

describe("toSarifLog (unit)", () => {
  function diagnostic(overrides: Partial<LintDiagnostic> = {}): LintDiagnostic {
    return {
      rule: "some-rule",
      severity: "error",
      message: "message",
      range: {
        filePath: "/repo/openapi.yaml",
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
        startOffset: 0,
        endOffset: 5,
      },
      ...overrides,
    };
  }

  test("falls back to an absolute file:// URI when the file is outside cwd", () => {
    const log = toSarifLog([diagnostic({ range: { ...diagnostic().range, filePath: "/outside/openapi.yaml" } })], "/repo");
    expect(log.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toBe("file:///outside/openapi.yaml");
  });

  test("uses a repo-relative uri when the file is inside cwd", () => {
    const log = toSarifLog([diagnostic()], "/repo");
    expect(log.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toBe("openapi.yaml");
  });

  test("maps info severity to note level", () => {
    const log = toSarifLog([diagnostic({ severity: "info" })], "/repo");
    expect(log.runs[0]?.results[0]?.level).toBe("note");
  });

  test("maps warn severity to warning level", () => {
    const log = toSarifLog([diagnostic({ severity: "warn" })], "/repo");
    expect(log.runs[0]?.results[0]?.level).toBe("warning");
  });
});
