import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";
import type { LintConfigFile } from "../src/config.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function lintFixture(relativePath: string) {
  const fs = new NodeFileSystem();
  const entry = `${fixturesRoot}/${relativePath}`;
  const graph = await loadWorkspaceGraph(fs, entry);
  const config = resolveConfig(undefined);
  return lint(graph, config);
}

describe("operation/operation-id", () => {
  test("flags an operation missing operationId", async () => {
    const diagnostics = await lintFixture("operations/missing-operation-id.yaml");
    const d = diagnostics.find((d) => d.rule === "operation/operation-id");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.range.start.line).toBe(7);
  });

  test("flags a duplicate operationId across two paths", async () => {
    const diagnostics = await lintFixture("operations/duplicate-operation-id.yaml");
    const dupes = diagnostics.filter((d) => d.rule === "operation/operation-id");
    expect(dupes.length).toBeGreaterThanOrEqual(1);
    expect(dupes.some((d) => d.message.includes("Duplicate operationId"))).toBe(true);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "operation/operation-id")).toBe(false);
  });

  test("reports duplicate operationIds deterministically with per-file overrides", async () => {
    const entry = "/virtual/entry.yaml";
    const configPath = "/virtual/oasis.config.jsonc";
    const operation = `get:\n  operationId: duplicate\n  tags: [t]\n  description: ok\n  responses:\n    '200': { description: OK }\n`;

    async function duplicateDiagnostics(
      pathOrder: readonly ("a" | "b")[],
      config: LintConfigFile | undefined,
    ) {
      const paths = pathOrder.map((name) => `  /${name}: { $ref: './paths/${name}.yaml' }`).join("\n");
      const graph = await loadWorkspaceGraph(
        new InMemoryFileSystem({
          [entry]: `openapi: 3.1.0\ninfo: { title: T, version: "1" }\npaths:\n${paths}\n`,
          "/virtual/paths/a.yaml": operation,
          "/virtual/paths/b.yaml": operation,
        }),
        entry,
      );
      return lint(graph, resolveConfig(config), { configPath })
        .filter((diagnostic) => diagnostic.rule === "operation/operation-id")
        .map(({ message, range, severity }) => ({ message, filePath: range.filePath, start: range.start, end: range.end, severity }));
    }

    const configurations: { name: string; config: LintConfigFile | undefined; expectedFile: string; expectedOtherPath: string }[] = [
      { name: "globally enabled", config: undefined, expectedFile: "/virtual/paths/b.yaml", expectedOtherPath: "/a" },
      {
        name: "enabled only for a.yaml",
        config: { lint: { rules: { "operation/operation-id": "off" }, overrides: [{ files: ["paths/a.yaml"], rules: { "operation/operation-id": "error" } }] } },
        expectedFile: "/virtual/paths/a.yaml",
        expectedOtherPath: "/b",
      },
      {
        name: "disabled for a.yaml",
        config: { lint: { overrides: [{ files: ["paths/a.yaml"], rules: { "operation/operation-id": "off" } }] } },
        expectedFile: "/virtual/paths/b.yaml",
        expectedOtherPath: "/a",
      },
    ];

    for (const { name, config, expectedFile, expectedOtherPath } of configurations) {
      const aThenB = await duplicateDiagnostics(["a", "b"], config);
      const bThenA = await duplicateDiagnostics(["b", "a"], config);

      expect(bThenA, name).toEqual(aThenB);
      expect(aThenB, name).toEqual([
        {
          message: `Duplicate operationId "duplicate" (also used by "GET ${expectedOtherPath}").`,
          filePath: expectedFile,
          start: { line: 1, character: 15 },
          end: { line: 1, character: 24 },
          severity: "error",
        },
      ]);
    }
  });

  test("retains a diagnostic for every enabled duplicate beyond a deterministic witness", async () => {
    const entry = "/virtual/entry.yaml";
    const configPath = "/virtual/oasis.config.jsonc";
    const operation = `get:\n  operationId: duplicate\n  tags: [t]\n  description: ok\n  responses:\n    '200': { description: OK }\n`;

    async function duplicateDiagnostics(
      pathOrder: readonly ("a" | "b" | "c")[],
      config: LintConfigFile | undefined,
    ) {
      const paths = pathOrder.map((name) => `  /${name}: { $ref: './paths/${name}.yaml' }`).join("\n");
      const graph = await loadWorkspaceGraph(
        new InMemoryFileSystem({
          [entry]: `openapi: 3.1.0\ninfo: { title: T, version: "1" }\npaths:\n${paths}\n`,
          "/virtual/paths/a.yaml": operation,
          "/virtual/paths/b.yaml": operation,
          "/virtual/paths/c.yaml": operation,
        }),
        entry,
      );
      return lint(graph, resolveConfig(config), { configPath })
        .filter((diagnostic) => diagnostic.rule === "operation/operation-id")
        .map(({ message, range, severity }) => ({ message, filePath: range.filePath, start: range.start, end: range.end, severity }));
    }

    const expected = (owners: readonly [string, string], witness: string) => owners.map((owner) => ({
      message: `Duplicate operationId "duplicate" (also used by "GET /${witness}").`,
      filePath: `/virtual/paths/${owner}.yaml`,
      start: { line: 1, character: 15 },
      end: { line: 1, character: 24 },
      severity: "error" as const,
    }));

    const globallyEnabled = await duplicateDiagnostics(["a", "b", "c"], undefined);
    expect(await duplicateDiagnostics(["c", "b", "a"], undefined)).toEqual(globallyEnabled);
    expect(globallyEnabled).toEqual(expected(["b", "c"], "a"));

    const bAndCEnabled: LintConfigFile = {
      lint: {
        rules: { "operation/operation-id": "off" },
        overrides: [{ files: ["paths/b.yaml", "paths/c.yaml"], rules: { "operation/operation-id": "error" } }],
      },
    };
    const overrideDiagnostics = await duplicateDiagnostics(["a", "b", "c"], bAndCEnabled);
    expect(await duplicateDiagnostics(["c", "b", "a"], bAndCEnabled)).toEqual(overrideDiagnostics);
    expect(overrideDiagnostics).toEqual(expected(["b", "c"], "a"));
  });
});

describe("operation/tags", () => {
  test("flags an operation with no tags", async () => {
    const diagnostics = await lintFixture("operations/missing-tags.yaml");
    const d = diagnostics.find((d) => d.rule === "operation/tags");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warn");
    expect(d?.range.start.line).toBe(7);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "operation/tags")).toBe(false);
  });
});

describe("operation/description", () => {
  test("flags an operation with neither description nor summary", async () => {
    const diagnostics = await lintFixture("operations/missing-description.yaml");
    const d = diagnostics.find((d) => d.rule === "operation/description");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warn");
    expect(d?.range.start.line).toBe(7);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "operation/description")).toBe(false);
  });
});
