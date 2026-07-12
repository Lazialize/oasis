import { describe, expect, test } from "bun:test";
import { allDiagnostics, InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import type { Diagnostic } from "@oasis/core";
import { lint, resolveConfig } from "@oasis/linter";
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

describe("bundle --dereference", () => {
  test("simple cross-file ref: inlined in place, no components section left", async () => {
    const graph = await loadFixture("deref-simple");
    const result = bundle(graph, { dereference: true });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).not.toContain("$ref");
    expect(result.output).not.toContain("shared.yaml");
    expect(result.output).not.toContain("components:");
    expect(result.output).toContain("type: object");
    expect(result.output).toContain("name:");
    await assertSelfContained(result.output);
  });

  test("nested/recursive ref inside a dereferenced target is itself inlined", async () => {
    const graph = await loadFixture("deref-nested");
    const result = bundle(graph, { dereference: true });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).not.toContain("$ref");
    expect(result.output).not.toContain("components:");
    expect(result.output).toContain("owner:");
    await assertSelfContained(result.output);
  });

  test("same-document ref is inlined and the now-unreachable component is dropped", async () => {
    const graph = await loadFixture("deref-samedoc");
    const result = bundle(graph, { dereference: true });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).not.toContain("$ref");
    expect(result.output).not.toContain("components:");
    await assertSelfContained(result.output);
  });

  test("direct self-cycle: kept as a $ref to a minimal components entry, with a warning", async () => {
    const graph = await loadFixture("deref-self-cycle");
    const result = bundle(graph, { dereference: true });

    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0]?.severity).toBe("warning");
    expect(result.diagnostics[0]?.code).toBe("ref-cycle");

    expect(result.output).toContain("components:");
    expect(result.output).toContain("Node:");
    expect(result.output).toContain("#/components/schemas/Node");

    const diagnostics = await assertSelfContained(result.output);
    expect(diagnostics.filter((d) => d.code === "no-unresolved-ref")).toEqual([]);
  });

  test("mutual A<->B cycle across files: minimal components kept, with a warning", async () => {
    const graph = await loadFixture("deref-mutual-cycle");
    const result = bundle(graph, { dereference: true });

    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0]?.severity).toBe("warning");
    expect(result.diagnostics[0]?.code).toBe("ref-cycle");

    expect(result.output).toContain("components:");
    expect(result.output).toContain("A:");
    expect(result.output).toContain("#/components/schemas/A");
    expect(result.output).not.toContain("a.yaml");
    expect(result.output).not.toContain("b.yaml");

    const diagnostics = await assertSelfContained(result.output);
    expect(diagnostics.filter((d) => d.code === "no-unresolved-ref")).toEqual([]);
  });

  test("unresolved ref: kept verbatim with the existing warning behavior", async () => {
    const graph = await loadFixture("deref-unresolved");
    const result = bundle(graph, { dereference: true });
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics[0]?.severity).toBe("warning");
    expect(result.output).toContain("./missing.yaml#/components/schemas/Foo");
  });

  test("mixed cycle + acyclic doc: cyclic and unreferenced components kept, reachable-acyclic ones dropped", async () => {
    const graph = await loadFixture("deref-mixed");
    const result = bundle(graph, { dereference: true });

    expect(result.diagnostics.length).toBe(1); // one ref-cycle warning for Node
    expect(result.diagnostics[0]?.code).toBe("ref-cycle");

    expect(result.output).toContain("Node:"); // cycle participant: kept
    expect(result.output).toContain("Extra:"); // unreferenced entry component: kept verbatim
    expect(result.output).not.toContain("Pet:"); // reachable-but-acyclic: inlined and dropped
    expect(result.output).not.toContain("Owner:"); // reachable-but-acyclic: inlined and dropped
    expect(result.output).not.toContain("shared.yaml");

    const diagnostics = await assertSelfContained(result.output);
    const unresolvedRefs = diagnostics.filter((d) => d.code === "no-unresolved-ref");
    expect(unresolvedRefs).toEqual([]);

    const bundledFs = new InMemoryFileSystem({ "/virtual/bundled.yaml": result.output });
    const bundledGraph = await loadWorkspaceGraph(bundledFs, "/virtual/bundled.yaml");
    const lintDiagnostics = lint(bundledGraph, resolveConfig({ lint: { rules: { "no-unused-components": "off" } } }));
    const structureErrors = lintDiagnostics.filter((d) => d.rule.startsWith("structure/") && d.severity === "error");
    expect(structureErrors).toEqual([]);
  });

  test("output re-parses cleanly and re-lints without unresolved-ref/structure errors", async () => {
    const graph = await loadFixture("deref-nested");
    const result = bundle(graph, { dereference: true });

    const bundledFs = new InMemoryFileSystem({ "/virtual/bundled.yaml": result.output });
    const bundledGraph = await loadWorkspaceGraph(bundledFs, "/virtual/bundled.yaml");
    const diagnostics = lint(bundledGraph, resolveConfig(undefined));
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  test("determinism: bundling twice produces byte-identical output", async () => {
    const graph1 = await loadFixture("deref-mixed");
    const result1 = bundle(graph1, { dereference: true }).output;
    const graph2 = await loadFixture("deref-mixed");
    const result2 = bundle(graph2, { dereference: true }).output;
    expect(result1).toBe(result2);
  });

  test("JSON output format round-trips", async () => {
    const graph = await loadFixture("deref-simple");
    const result = bundle(graph, { dereference: true, format: "json" });
    const parsed = JSON.parse(result.output);
    expect(parsed.openapi).toBe("3.0.3");
    expect(parsed.components).toBeUndefined();
    await assertSelfContained(result.output, "json");
  });
});
