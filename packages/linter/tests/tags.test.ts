import { describe, expect, test } from "bun:test";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function lintFixture(relativePath: string, configFile?: Parameters<typeof resolveConfig>[0]) {
  const fs = new NodeFileSystem();
  const entry = `${fixturesRoot}/${relativePath}`;
  const graph = await loadWorkspaceGraph(fs, entry);
  const config = resolveConfig(configFile);
  return lint(graph, config);
}

describe("tags-defined", () => {
  test("is off by default", async () => {
    const diagnostics = await lintFixture("tags/undeclared-tag.yaml");
    expect(diagnostics.some((d) => d.rule === "tags-defined")).toBe(false);
  });

  test("flags an operation tag not declared at the root, when enabled", async () => {
    const diagnostics = await lintFixture("tags/undeclared-tag.yaml", { lint: { rules: { "tags-defined": "error" } } });
    const d = diagnostics.find((d) => d.rule === "tags-defined");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.message).toContain("reptiles");
  });

  test("valid fixture passes when enabled", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml", { lint: { rules: { "tags-defined": "error" } } });
    expect(diagnostics.some((d) => d.rule === "tags-defined")).toBe(false);
  });
});

describe("no-unused-tags", () => {
  test("flags a root tag not used by any operation", async () => {
    const diagnostics = await lintFixture("tags/unused-tag.yaml");
    const d = diagnostics.find((d) => d.rule === "no-unused-tags");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warning");
    expect(d?.message).toContain("reptiles");
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "no-unused-tags")).toBe(false);
  });
});
