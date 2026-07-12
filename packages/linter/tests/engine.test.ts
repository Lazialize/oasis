import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

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
