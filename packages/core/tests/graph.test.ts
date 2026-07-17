import { describe, expect, test } from "bun:test";
import { resolve as pathResolve } from "node:path";
import { InMemoryFileSystem } from "../src/filesystem.ts";
import { allDiagnostics, graphReferences, loadWorkspaceGraph } from "../src/graph.ts";

describe("entry path canonicalization (issue #25)", () => {
  test("a relative entry is loaded once, under its canonical path", async () => {
    const fs = new InMemoryFileSystem({
      "tmp-oasis/entry.yaml": [
        "openapi: 3.0.3",
        "info: { title: t, version: '1' }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Ref: { $ref: './other.yaml#/components/schemas/Thing' }",
      ].join("\n"),
      "tmp-oasis/other.yaml": [
        "components:",
        "  schemas:",
        "    Thing: { $ref: './entry.yaml#/components/schemas/Ref' }",
      ].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "tmp-oasis/entry.yaml");

    const canonicalEntry = pathResolve("tmp-oasis/entry.yaml");
    const canonicalOther = pathResolve("tmp-oasis/other.yaml");

    // Exactly two documents: the entry (once) and the other file — no duplicate identity.
    expect([...graph.documents.keys()].sort()).toEqual([canonicalEntry, canonicalOther].sort());
    expect(graph.documents.size).toBe(2);

    // The graph exposes the canonical entry path.
    expect(graph.entryPath).toBe(canonicalEntry);

    // The relative key must NOT appear.
    expect(graph.documents.has("tmp-oasis/entry.yaml")).toBe(false);
  });

  test("a two-file cycle reached from a relative entry yields a single cycle diagnostic", async () => {
    const fs = new InMemoryFileSystem({
      "tmp-oasis/a.yaml": "x: { $ref: './b.yaml#/y' }",
      "tmp-oasis/b.yaml": "y: { $ref: './a.yaml#/x' }",
    });

    const graph = await loadWorkspaceGraph(fs, "tmp-oasis/a.yaml");

    expect(graph.documents.size).toBe(2);
    const cycles = allDiagnostics(graph).filter((d) => d.code === "no-ref-cycle");
    expect(cycles.length).toBe(1);
  });

  test("a self reference from a relative entry does not duplicate the document", async () => {
    const fs = new InMemoryFileSystem({
      "tmp-oasis/self.yaml": [
        "openapi: 3.0.3",
        "info: { title: t, version: '1' }",
        "components:",
        "  schemas:",
        "    A: { type: object }",
        "    B: { $ref: './self.yaml#/components/schemas/A' }",
      ].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "tmp-oasis/self.yaml");

    expect(graph.documents.size).toBe(1);
    expect(graph.entryPath).toBe(pathResolve("tmp-oasis/self.yaml"));
    // A same-file self ref is not a cross-file cycle.
    expect(allDiagnostics(graph).filter((d) => d.code === "no-ref-cycle")).toEqual([]);
  });
});

describe("resolved-target cycle detection (issue #86)", () => {
  test("detects direct and indirect same-document cycles", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/direct.yaml": "A: { $ref: '#/A' }",
      "/virtual/indirect.yaml": [
        "A: { $ref: '#/B' }",
        "B: { $ref: '#/C' }",
        "C: { $ref: '#/A' }",
      ].join("\n"),
    });

    const direct = await loadWorkspaceGraph(fs, "/virtual/direct.yaml");
    const indirect = await loadWorkspaceGraph(fs, "/virtual/indirect.yaml");

    expect(direct.diagnostics.filter((d) => d.code === "no-ref-cycle")).toHaveLength(1);
    expect(indirect.diagnostics.filter((d) => d.code === "no-ref-cycle")).toHaveLength(1);
  });

  test("detects a cross-file target cycle at the closing reference", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/a.yaml": "A: { $ref: './b.yaml#/B' }",
      "/virtual/b.yaml": "B:\n  $ref: './a.yaml#/A'",
    });

    const graph = await loadWorkspaceGraph(fs, "/virtual/a.yaml");
    const cycles = graph.diagnostics.filter((d) => d.code === "no-ref-cycle");

    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.range.filePath).toBe("/virtual/b.yaml");
    expect(cycles[0]?.range.start.line).toBe(1);
    expect(cycles[0]?.range.start.character).toBe(8);
  });

  test("does not report mutual file dependencies whose target chains terminate", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/a.yaml": ["A: { $ref: './b.yaml#/B' }", "C: { type: string }"].join("\n"),
      "/virtual/b.yaml": ["B: { type: integer }", "X: { $ref: './a.yaml#/C' }"].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "/virtual/a.yaml");

    expect(graph.documents.size).toBe(2);
    expect(graph.diagnostics.filter((d) => d.code === "no-ref-cycle")).toEqual([]);
  });

  test("keeps aliased reference identities distinct between $id resource scopes", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    One:",
        "      $id: root.json",
        "      $defs:",
        "        Use: &shared { $ref: 'sub/next.json#/$defs/Use' }",
        "    Two:",
        "      $id: sub/next.json",
        "      $defs: { Use: *shared }",
      ].join("\n"),
      "/api/sub/sub/next.json": "$defs: { Use: { type: string } }\n",
    });

    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");

    // The shared node is reached as S@root -> S@sub/next -> terminal. Collapsing those first two
    // identities to their common AST node would turn the first edge into a false self-cycle.
    expect([...graph.documents.keys()].sort()).toEqual([
      "/api/entry.yaml",
      "/api/sub/sub/next.json",
    ]);
    expect(graph.diagnostics.filter((d) => d.code === "no-ref-cycle")).toEqual([]);
  });

  test("keeps distinct owners of a scalar-aliased ref for cycle detection", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.1.0",
        "x-ref: &ref '#/components/schemas/A'",
        "components:",
        "  schemas:",
        "    B: { $ref: *ref }",
        "    A: { $ref: *ref }",
      ].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const entry = graph.documents.get("/virtual/entry.yaml")!;

    // Public semantic references remain deduplicated by source scalar and base, while the internal
    // cycle walk retains B -> A and the later A -> A owner occurrence that closes the cycle.
    expect(graphReferences(graph, entry).filter((ref) => ref.value.endsWith("/A"))).toHaveLength(1);
    expect(graph.diagnostics.filter((d) => d.code === "no-ref-cycle")).toHaveLength(1);
  });
});
