import { describe, expect, test } from "bun:test";
import { allDiagnostics, InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import type { Diagnostic } from "@oasis/core";
import { bundle } from "../src/index.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function loadFixture(dir: string, entryFile = "entry.yaml") {
  const fs = new NodeFileSystem();
  return loadWorkspaceGraph(fs, `${fixturesRoot}/${dir}/${entryFile}`);
}

/** Re-parse bundled output as a single in-memory document and assert it's fully self-contained. */
async function assertSelfContained(output: string, ext: "yaml" | "json" = "yaml"): Promise<Diagnostic[]> {
  const path = `/virtual/bundled.${ext}`;
  const fs = new InMemoryFileSystem({ [path]: output });
  const graph = await loadWorkspaceGraph(fs, path);
  const diags = allDiagnostics(graph);
  const errors = diags.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
  expect(graph.documents.size).toBe(1); // no external files pulled in
  return diags;
}

describe("bundle: discriminator.mapping", () => {
  test("a mapping ref pointing at an external file is loaded, lifted, and rewritten identically to the sibling oneOf $ref", async () => {
    const graph = await loadFixture("discriminator-mapping");
    // The mapping-only external file must have been loaded into the workspace graph (findRefs must
    // see the mapping value, not just the sibling $ref in this fixture).
    expect([...graph.documents.keys()].some((p) => p.endsWith("dog.yaml"))).toBe(true);

    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);
    expect(result.output).not.toContain("dog.yaml");

    // Both the discriminator mapping entry and the sibling oneOf $ref must land on the same
    // rewritten pointer for the lifted Dog schema.
    const dogRefOccurrences = (result.output.match(/#\/components\/schemas\/Dog/g) ?? []).length;
    expect(dogRefOccurrences).toBe(2);

    // A bare component-name mapping value (`cat: 'Cat'`) must be left untouched.
    expect(result.output).toContain("cat: Cat");

    await assertSelfContained(result.output);
  });

  test("a file referenced only via a discriminator.mapping value (no sibling $ref) is still loaded and lifted", async () => {
    const graph = await loadFixture("discriminator-mapping-only");
    expect([...graph.documents.keys()].some((p) => p.endsWith("dog.yaml"))).toBe(true);

    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);
    expect(result.output).not.toContain("dog.yaml");
    expect(result.output).toContain("#/components/schemas/Dog");
    expect(result.output).toContain("Dog:");

    await assertSelfContained(result.output);
  });
});
