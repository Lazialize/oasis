import { describe, expect, test } from "bun:test";
import { resolve as pathResolve } from "node:path";
import { InMemoryFileSystem } from "../src/filesystem.ts";
import { allDiagnostics, loadWorkspaceGraph } from "../src/graph.ts";

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
