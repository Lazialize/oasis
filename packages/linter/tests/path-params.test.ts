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

describe("path-params-defined", () => {
  test("flags a path template param with no matching parameter definition", async () => {
    const diagnostics = await lintFixture("path-params/mismatch.yaml");
    const d = diagnostics.find((d) => d.rule === "path-params-defined");
    expect(d).toBeDefined();
    expect(d?.message).toContain("{id}");
  });

  test("flags a path parameter that is not required", async () => {
    const diagnostics = await lintFixture("path-params/not-required.yaml");
    const d = diagnostics.find((d) => d.rule === "path-params-defined");
    expect(d).toBeDefined();
    expect(d?.message).toContain("required: true");
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "path-params-defined")).toBe(false);
  });
});
