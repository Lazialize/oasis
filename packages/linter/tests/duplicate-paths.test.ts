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

describe("no-duplicate-paths", () => {
  test("flags two path templates that differ only in parameter name", async () => {
    const diagnostics = await lintFixture("duplicate-paths/conflict.yaml");
    const d = diagnostics.find((d) => d.rule === "no-duplicate-paths");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.message).toContain("/users/{userId}");
    expect(d?.message).toContain("/users/{id}");
  });

  test("does not flag paths that only share a static prefix", async () => {
    const diagnostics = await lintFixture("duplicate-paths/no-conflict.yaml");
    expect(diagnostics.some((d) => d.rule === "no-duplicate-paths")).toBe(false);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "no-duplicate-paths")).toBe(false);
  });
});
