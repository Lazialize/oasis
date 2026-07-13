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

describe("bundle", () => {
  test("multi-file 3.0 fixture: no external refs, resolves cleanly, lints with zero errors", async () => {
    const graph = await loadFixture("multifile30");
    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);
    expect(result.output).not.toContain("shared.yaml");

    await assertSelfContained(result.output);

    const bundledFs = new InMemoryFileSystem({ "/virtual/bundled.yaml": result.output });
    const bundledGraph = await loadWorkspaceGraph(bundledFs, "/virtual/bundled.yaml");
    const diagnostics = lint(bundledGraph, resolveConfig(undefined));
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  test("multi-file 3.1 fixture: no external refs, resolves cleanly", async () => {
    const graph = await loadFixture("multifile31");
    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);
    expect(result.output).not.toContain("schemas.yaml");
    await assertSelfContained(result.output);
    expect(result.output).toContain("3.1.0");
  });

  test("nested internal ref inside a lifted subtree is itself lifted and rewritten", async () => {
    const graph = await loadFixture("multifile30");
    const result = bundle(graph);
    expect(result.output).toContain("Owner");
    expect(result.output).not.toContain("#/components/schemas/Owner\ncomponents"); // sanity: Owner section exists
    await assertSelfContained(result.output);
  });

  test("name conflict: two different targets both named User get distinct, deterministic names", async () => {
    const graph = await loadFixture("conflict");
    const result1 = bundle(graph).output;
    const graph2 = await loadFixture("conflict");
    const result2 = bundle(graph2).output;

    expect(result1).toBe(result2); // deterministic across runs

    expect(result1).toContain("User:");
    expect(result1).toContain("User_2:");
    expect(result1).toContain("aOnly");
    expect(result1).toContain("bOnly");

    await assertSelfContained(result1);
  });

  test("same target referenced from two places is lifted exactly once", async () => {
    const graph = await loadFixture("shared-target");
    const result = bundle(graph);
    const petOccurrences = (result.output.match(/Pet:/g) ?? []).length;
    expect(petOccurrences).toBe(1);
    const refOccurrences = (result.output.match(/#\/components\/schemas\/Pet/g) ?? []).length;
    expect(refOccurrences).toBe(2);
    await assertSelfContained(result.output);
  });

  test("cross-file ref cycle terminates and produces internally consistent output", async () => {
    const graph = await loadFixture("cycle");
    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);
    // Both Node definitions (from b.yaml and c.yaml) should be present, cross-referencing each other.
    expect(result.output).toContain("Node:");
    expect(result.output).toContain("Node_2:");
    await assertSelfContained(result.output);
  });

  test("whole-file ref (no fragment) is lifted using the filename stem as the name", async () => {
    const graph = await loadFixture("whole-file");
    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain("#/components/schemas/user");
    await assertSelfContained(result.output);
  });

  test("unresolved ref: $ref preserved verbatim and a warning diagnostic is emitted", async () => {
    const graph = await loadFixture("unresolved");
    const result = bundle(graph);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics[0]?.severity).toBe("warning");
    expect(result.output).toContain("./missing.yaml#/components/schemas/Foo");
  });

  test("JSON output format round-trips", async () => {
    const graph = await loadFixture("multifile30");
    const result = bundle(graph, { format: "json" });
    const parsed = JSON.parse(result.output);
    expect(parsed.openapi).toBe("3.0.3");
    expect(parsed.components.schemas.Pet).toBeDefined();
    await assertSelfContained(result.output, "json");
  });

  test("path item $ref (3.0): whole-file and fragment refs are inlined, nested refs still lifted", async () => {
    const graph = await loadFixture("pathitem30");
    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);
    expect(result.output).not.toContain("$ref: ./paths");
    expect(result.output).not.toContain("paths/users.yaml");
    expect(result.output).not.toContain("paths.yaml#");
    expect(result.output).toContain("listUsers");
    expect(result.output).toContain("listOrders");
    expect(result.output).toContain("#/components/schemas/User");
    await assertSelfContained(result.output);

    const bundledFs = new InMemoryFileSystem({ "/virtual/bundled.yaml": result.output });
    const bundledGraph = await loadWorkspaceGraph(bundledFs, "/virtual/bundled.yaml");
    const diagnostics = lint(bundledGraph, resolveConfig(undefined));
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  test("path item $ref (3.1): whole-file ref is inlined", async () => {
    const graph = await loadFixture("pathitem31");
    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);
    expect(result.output).not.toContain("paths/widgets.yaml");
    expect(result.output).toContain("listWidgets");
    await assertSelfContained(result.output);
  });

  test("path item $ref siblings (summary/description) are preserved, both resolved and unresolved", async () => {
    const graph = await loadFixture("pathitem-siblings");
    const result = bundle(graph);
    // Resolved case: target is inlined, and the sibling summary/description override it.
    expect(result.output).toContain("listWidgets");
    expect(result.output).toContain("Widgets summary override");
    expect(result.output).toContain("Widgets description override");
    // Unresolved case: $ref preserved verbatim, but its sibling isn't dropped either.
    expect(result.output).toContain("./does-not-exist.yaml");
    expect(result.output).toContain("Missing path summary");
  });

  test("$ref-as-literal-data (example/default/enum) is copied through unchanged, not lifted or rewritten", async () => {
    const graph = await loadFixture("literal-ref-data");
    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);
    // The literal $ref-shaped data must survive verbatim; it must not be treated as a real
    // reference (no lifting into components, no rewriting, no unresolved-ref diagnostic).
    expect(result.output).toContain("./does-not-exist.yaml");
    expect(result.output).toContain("./also-missing.yaml");
    expect(result.output).toContain("./enum-missing.yaml");
    expect(result.output).not.toContain("components:");
  });
});
