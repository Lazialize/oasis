import { describe, expect, test } from "bun:test";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

describe("multi-file lint", () => {
  test("reports a rule violation in a referenced (non-entry) file", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/multifile/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const config = resolveConfig(undefined);
    const diagnostics = lint(graph, config);

    const d = diagnostics.find((d) => d.rule === "operation/operation-id");
    expect(d).toBeDefined();
    expect(d?.range.filePath).toBe(`${fixturesRoot}/multifile/paths-pets.yaml`);
    expect(d?.range.filePath).not.toBe(entry);
  });
});
