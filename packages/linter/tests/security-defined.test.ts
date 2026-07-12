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

describe("security/defined", () => {
  test("flags an undefined scheme referenced at the document root", async () => {
    const diagnostics = await lintFixture("security/undefined-root.yaml");
    const d = diagnostics.find((d) => d.rule === "security/defined");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.message).toContain("apiKey");
  });

  test("flags an undefined scheme referenced at the operation level", async () => {
    const diagnostics = await lintFixture("security/undefined-operation.yaml");
    const d = diagnostics.find((d) => d.rule === "security/defined");
    expect(d).toBeDefined();
    expect(d?.message).toContain("oauth2");
  });

  test('accepts a defined scheme and an empty "{}" (optional) requirement', async () => {
    const diagnostics = await lintFixture("security/valid.yaml");
    expect(diagnostics.some((d) => d.rule === "security/defined")).toBe(false);
  });

  test("flags a violation in a referenced (non-entry) file", async () => {
    const diagnostics = await lintFixture("security/multifile/entry.yaml");
    const d = diagnostics.find((d) => d.rule === "security/defined");
    expect(d).toBeDefined();
    expect(d?.range.filePath).toBe(`${fixturesRoot}/security/multifile/paths-pets.yaml`);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "security/defined")).toBe(false);
  });
});
