import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint, resolveConfig } from "@oasis/linter";
import { bundle } from "../src/index.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function loadFixture(dir: string, entryFile = "entry.yaml") {
  const fs = new NodeFileSystem();
  return loadWorkspaceGraph(fs, `${fixturesRoot}/${dir}/${entryFile}`);
}

/** Re-parse and lint the bundled output, asserting no unresolved-ref or discriminator errors remain. */
async function assertLintsClean(output: string): Promise<void> {
  const path = "/virtual/bundled.yaml";
  const fs = new InMemoryFileSystem({ [path]: output });
  const bundledGraph = await loadWorkspaceGraph(fs, path);
  const diagnostics = lint(bundledGraph, resolveConfig(undefined));
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
}

describe("bundle --dereference: discriminator.mapping retention (issue #88)", () => {
  test("explicit pointer-form mapping, 3.0, mapping declared before oneOf: Dog stays resolvable", async () => {
    const graph = await loadFixture("discriminator-mapping-retention-explicit-30");
    const result = bundle(graph, { dereference: true });

    expect(result.output).toContain("Dog:");
    expect(result.output).toContain("#/components/schemas/Dog");
    await assertLintsClean(result.output);
  });

  test("explicit pointer-form mapping, 3.1, mapping declared after oneOf: Dog stays resolvable", async () => {
    const graph = await loadFixture("discriminator-mapping-retention-explicit-31");
    const result = bundle(graph, { dereference: true });

    expect(result.output).toContain("Dog:");
    expect(result.output).toContain("#/components/schemas/Dog");
    await assertLintsClean(result.output);
  });

  test("bare component-name mapping, 3.0, mapping declared before oneOf: Dog stays resolvable", async () => {
    const graph = await loadFixture("discriminator-mapping-retention-bare-30");
    const result = bundle(graph, { dereference: true });

    expect(result.output).toContain("Dog:");
    expect(result.output).toContain("dog: Dog");
    await assertLintsClean(result.output);
  });

  test("bare component-name mapping, 3.1, mapping declared after oneOf: Dog stays resolvable", async () => {
    const graph = await loadFixture("discriminator-mapping-retention-bare-31");
    const result = bundle(graph, { dereference: true });

    expect(result.output).toContain("Dog:");
    expect(result.output).toContain("dog: Dog");
    await assertLintsClean(result.output);
  });

  test("control: without a discriminator, a same-entry oneOf ref is still inlined and the schema dropped", async () => {
    const graph = await loadFixture("discriminator-mapping-retention-control");
    const result = bundle(graph, { dereference: true });

    // No discriminator.mapping keeps Dog alive, so the usual dereference pruning still applies.
    expect(result.output).not.toContain("Dog:");
    expect(result.output).not.toContain("components:");
    await assertLintsClean(result.output);
  });
});
