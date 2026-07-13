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

// #29: dereference cycle slots use uniqueName machinery and don't overwrite existing components.
describe("#29 cycle slots never overwrite existing components", () => {
  test("external cycle target colliding with an entry component gets a deduped name", async () => {
    const graph = await loadFixture("deref-cycle-conflict");
    const result = bundle(graph, { dereference: true });

    const doc = parseYaml(result.output) as any;
    // User-defined entry `child` is untouched.
    expect(doc.components.schemas.child).toEqual({
      description: "User-defined child, must not be overwritten",
      type: "string",
    });
    // The external cycle target got a fresh, non-colliding slot.
    expect(doc.components.schemas.child_2).toBeDefined();
    expect(doc.components.schemas.child_2.properties.self).toEqual({
      $ref: "#/components/schemas/child_2",
    });

    // A diamond onto the same cycle site emits exactly one deduplicated diagnostic.
    expect(result.diagnostics.filter((d) => d.code === "ref-cycle")).toHaveLength(1);

    await assertSelfContained(result.output);
  });

  test("entry-document self-cycle keeps the component's own name", async () => {
    const graph = await loadFixture("deref-self-cycle");
    const result = bundle(graph, { dereference: true });
    const doc = parseYaml(result.output) as any;
    // The reserved entry name `Node` is reused for its own cycle slot, not renamed.
    expect(doc.components.schemas.Node).toBeDefined();
    expect(doc.components.schemas.Node.properties.next).toEqual({
      $ref: "#/components/schemas/Node",
    });
    expect(result.diagnostics.filter((d) => d.code === "ref-cycle")).toHaveLength(1);
    await assertSelfContained(result.output);
  });
});
