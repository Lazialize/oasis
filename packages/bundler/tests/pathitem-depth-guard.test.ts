import { describe, expect, test } from "bun:test";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { bundle } from "../src/index.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function loadFixture(dir: string, entryFile = "entry.yaml") {
  const fs = new NodeFileSystem();
  return loadWorkspaceGraph(fs, `${fixturesRoot}/${dir}/${entryFile}`);
}

describe("bundle: Path Item $ref chain exceeding the depth guard", () => {
  test("emits a warning diagnostic and leaves the $ref unresolved instead of lifting a Path Item into components/schemas", async () => {
    const graph = await loadFixture("pathitem-depth-guard");
    const result = bundle(graph);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("warning");
    expect(result.diagnostics[0]?.code).toBe("ref-depth-exceeded");

    // The malformed-bundle regression: a Path Item must never get lifted into components/schemas.
    expect(result.output).not.toContain("components:\n  schemas:");
    expect(result.output).not.toContain("schemas:");

    // The path-item $ref is left unresolved in place rather than silently dropped.
    expect(result.output).toContain("$ref: ./loop.yaml");
  });
});
