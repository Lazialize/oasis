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

describe("no-unused-components", () => {
  test("flags a schema defined but never referenced", async () => {
    const diagnostics = await lintFixture("unused-components/unused.yaml");
    const d = diagnostics.find((d) => d.rule === "no-unused-components");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warning");
    expect(d?.message).toContain("Orphan");
  });

  test("valid fixture passes (Pet schema is referenced)", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "no-unused-components")).toBe(false);
  });
});
