import { describe, expect, test } from "bun:test";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
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

describe("operation/success-response", () => {
  test("flags an operation with only a non-2xx/3xx response", async () => {
    const diagnostics = await lintFixture("success-response/no-success.yaml");
    const d = diagnostics.find((d) => d.rule === "operation/success-response");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warn");
  });

  test('flags an operation with only a "default" response', async () => {
    const diagnostics = await lintFixture("success-response/default-only.yaml");
    const d = diagnostics.find((d) => d.rule === "operation/success-response");
    expect(d).toBeDefined();
  });

  test('accepts a "2XX" range key', async () => {
    const diagnostics = await lintFixture("success-response/range.yaml");
    expect(diagnostics.some((d) => d.rule === "operation/success-response")).toBe(false);
  });

  test("flags a violation in a referenced (non-entry) file", async () => {
    const diagnostics = await lintFixture("success-response/multifile/entry.yaml");
    const d = diagnostics.find((d) => d.rule === "operation/success-response");
    expect(d).toBeDefined();
    expect(d?.range.filePath).toBe(`${fixturesRoot}/success-response/multifile/paths-pets.yaml`);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "operation/success-response")).toBe(false);
  });
});
