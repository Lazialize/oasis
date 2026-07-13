import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { allDiagnostics, InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { bundle } from "../src/index.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function loadFixture(dir: string, entryFile = "entry.yaml") {
  const fs = new NodeFileSystem();
  return loadWorkspaceGraph(fs, `${fixturesRoot}/${dir}/${entryFile}`);
}

async function assertSelfContained(output: string): Promise<void> {
  const path = "/virtual/bundled.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({ [path]: output }), path);
  expect(allDiagnostics(graph).filter((d) => d.severity === "error")).toEqual([]);
  expect(graph.documents.size).toBe(1);
}

// #63: dereferenced component retention is independent of source declaration order.
describe("#63 unreferenced-component retention is order-independent", () => {
  test("A-before-B and B-before-A retain the same component membership", async () => {
    const resultA = bundle(await loadFixture("deref-order-a"), { dereference: true });
    const resultB = bundle(await loadFixture("deref-order-b"), { dereference: true });

    const docA = parseYaml(resultA.output) as any;
    const docB = parseYaml(resultB.output) as any;

    const keysA = Object.keys(docA.components.schemas).sort();
    const keysB = Object.keys(docB.components.schemas).sort();

    // Both unreferenced components are retained regardless of declaration order.
    expect(keysA).toEqual(["A", "B"]);
    expect(keysB).toEqual(["A", "B"]);
    expect(keysA).toEqual(keysB);

    await assertSelfContained(resultA.output);
    await assertSelfContained(resultB.output);
  });
});
