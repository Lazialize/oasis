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

// #27: whole-document refs under `components/pathItems` are lifted into `components/pathItems`.
describe("#27 components/pathItems refs lift into components/pathItems", () => {
  test("whole-file and fragment refs land under pathItems, not schemas, with conflicts and nested lifts", async () => {
    const graph = await loadFixture("components-pathitems");
    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);

    const doc = parseYaml(result.output) as any;
    const pathItems = doc.components.pathItems as Record<string, unknown>;

    // The whole-file `$ref: ./item.yaml` is lifted into components/pathItems (name deduped against
    // the pre-existing `item`), never into components/schemas.
    expect(doc.components.schemas?.item).toBeUndefined();
    expect(pathItems.item).toBeDefined(); // pre-existing entry preserved
    expect(pathItems.item_2).toBeDefined(); // lifted whole-file path item
    expect(pathItems.Common).toEqual({ $ref: "#/components/pathItems/item_2" });

    // Fragment ref to another file's components/pathItems is also lifted under pathItems.
    expect(pathItems.Fragment).toEqual({ $ref: "#/components/pathItems/Special" });
    expect(pathItems.Special).toBeDefined();

    // A ref *inside* the lifted path item is lifted normally into components/schemas.
    expect(doc.components.schemas.Thing).toBeDefined();
    const liftedGet = (pathItems.item_2 as any).get;
    expect(liftedGet.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/Thing",
    });

    await assertSelfContained(result.output);
  });
});
