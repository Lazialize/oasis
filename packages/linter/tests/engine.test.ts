import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";
import type { Rule } from "../src/types.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function lintFixture(relativePath: string) {
  const fs = new NodeFileSystem();
  const entry = `${fixturesRoot}/${relativePath}`;
  const graph = await loadWorkspaceGraph(fs, entry);
  const config = resolveConfig(undefined);
  return lint(graph, config);
}

describe("valid fixture", () => {
  test("produces zero diagnostics", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics).toEqual([]);
  });
});

describe("syntax/no-duplicate-keys", () => {
  test("flags a duplicate key at its exact location", async () => {
    const diagnostics = await lintFixture("core-diagnostics/duplicate-keys.yaml");
    const d = diagnostics.find((d) => d.rule === "syntax/no-duplicate-keys");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.range.start.line).toBe(4);
  });
});

describe("refs/no-unresolved", () => {
  test("flags a $ref that resolves to nothing", async () => {
    const diagnostics = await lintFixture("core-diagnostics/unresolved-ref.yaml");
    const d = diagnostics.find((d) => d.rule === "refs/no-unresolved");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.range.start.line).toBe(16);
  });

  test("passing fixture has no unresolved refs", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "refs/no-unresolved")).toBe(false);
  });

  test("ignores missing files named only inside an external Example value", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.1.0",
        "info: { title: t, version: '1' }",
        "paths: {}",
        "components:",
        "  examples:",
        "    E: { $ref: './example.yaml' }",
      ].join("\n"),
      "/virtual/example.yaml": "value: { $ref: './missing-literal.yaml#/X' }",
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const diagnostics = lint(graph, resolveConfig(undefined));

    expect(diagnostics.filter((diagnostic) => diagnostic.rule === "refs/no-unresolved")).toEqual([]);
  });
});

describe("refs/no-cycle", () => {
  test("flags a circular $ref chain", async () => {
    const diagnostics = await lintFixture("core-diagnostics/cycle-a.yaml");
    const d = diagnostics.find((d) => d.rule === "refs/no-cycle");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warn");
  });

  test("passing fixture has no cycles", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "refs/no-cycle")).toBe(false);
  });
});

describe("missing entry document", () => {
  test("surfaces a single refs/no-unresolved error instead of silently reporting nothing", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/does-not-exist.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const config = resolveConfig(undefined);
    const diagnostics = lint(graph, config);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ rule: "refs/no-unresolved", severity: "error" });
    expect(diagnostics[0]?.range.filePath).toBe(entry);
  });

  test("respects a config that turns refs/no-unresolved off", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/does-not-exist.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const config = resolveConfig({ lint: { rules: { "refs/no-unresolved": "off" } } });
    const diagnostics = lint(graph, config);
    expect(diagnostics).toEqual([]);
  });
});

describe("report(): a per-file override of \"off\" silences reports even when they pass an explicit severity", () => {
  // A stand-in for structure/server-variables, the one built-in rule that reports with an
  // explicit `{ severity: "warn" }` (independent of the rule's own resolved severity).
  const fakeRule: Rule = {
    name: "fake/explicit-severity",
    description: "Always reports once with an explicit severity, for testing report() override handling.",
    defaultSeverity: "error",
    check(ctx) {
      ctx.report({ doc: ctx.entryDoc, pointer: "" }, "always reported", { severity: "warn" });
    },
  };
  const ruleList = [fakeRule];

  async function lintWithConfig(configFile: Parameters<typeof resolveConfig>[0]) {
    const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": "openapi: 3.0.3\ninfo:\n  title: T\n  version: '1.0.0'\npaths: {}\n" });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const config = resolveConfig(configFile, ruleList);
    return lint(graph, config, { configPath: "/virtual/oasis.config.jsonc" }, ruleList);
  }

  test("with no override, the explicit-severity report comes through", async () => {
    const diagnostics = await lintWithConfig(undefined);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("warn");
  });

  test('an override setting the rule "off" for the matching file silences the report, despite its explicit severity', async () => {
    const diagnostics = await lintWithConfig({
      lint: { overrides: [{ files: ["entry.yaml"], rules: { "fake/explicit-severity": "off" } }] },
    });
    expect(diagnostics).toEqual([]);
  });
});

describe("syntax errors", () => {
  test("are always emitted as errors, ignoring config severity for other rules", async () => {
    const mem = new InMemoryFileSystem({ "/virtual/entry.yaml": "openapi: 3.0.3\ninfo: [unterminated\n" });
    const graph = await loadWorkspaceGraph(mem, "/virtual/entry.yaml");
    const config = resolveConfig(undefined);
    const diagnostics = lint(graph, config);
    const syntaxErrors = diagnostics.filter((d) => d.rule === "syntax-error");
    expect(syntaxErrors.length).toBeGreaterThanOrEqual(1);
    expect(syntaxErrors[0]?.severity).toBe("error");
  });
});
