import { describe, expect, test } from "bun:test";
import { isMap, isScalar } from "yaml";
import type { YAMLMap } from "yaml";
import { NodeFileSystem, InMemoryFileSystem } from "../src/filesystem.ts";
import { allDiagnostics, loadWorkspaceGraph } from "../src/graph.ts";
import { resolveRef } from "../src/ref.ts";
import { detectVersion } from "../src/version.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

describe("cross-file $ref resolution (OpenAPI 3.0)", () => {
  test("resolves an external $ref to its target node", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/multifile30/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);

    expect(graph.documents.size).toBe(2);
    expect(allDiagnostics(graph)).toEqual([]);

    const entryDoc = graph.documents.get(entry)!;
    expect(detectVersion(entryDoc)).toBe("3.0");

    const result = resolveRef(graph, entryDoc, "./components.yaml#/components/schemas/Pet");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected resolved ref");
    expect(isMap(result.node)).toBe(true);
    expect(result.pointer).toBe("/components/schemas/Pet");
    expect(result.doc.filePath).toBe(`${fixturesRoot}/multifile30/components.yaml`);
  });
});

describe("cross-file $ref resolution (OpenAPI 3.1)", () => {
  test("resolves an external $ref and detects 3.1", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/multifile31/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);

    expect(graph.documents.size).toBe(2);
    expect(allDiagnostics(graph)).toEqual([]);

    const entryDoc = graph.documents.get(entry)!;
    expect(detectVersion(entryDoc)).toBe("3.1");

    const result = resolveRef(graph, entryDoc, "./schemas.yaml#/components/schemas/Pet");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected resolved ref");

    const nameType = resolveRef(graph, result.doc, "#/components/schemas/Pet/properties/name/type");
    // 3.1 nullable types are represented as a type array; just confirm we can walk to it.
    expect(nameType.ok).toBe(true);
  });
});

describe("$ref cycle detection", () => {
  test("terminates and records a diagnostic instead of looping", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/cycle/a.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);

    expect(graph.documents.size).toBe(2);
    const cycleDiagnostics = graph.diagnostics.filter((d) => d.code === "no-ref-cycle");
    expect(cycleDiagnostics.length).toBeGreaterThanOrEqual(1);
  });
});

describe("unresolved $ref", () => {
  test("missing file produces a graph-level diagnostic", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/misc/unresolved.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);

    const unresolved = graph.diagnostics.filter((d) => d.code === "no-unresolved-ref");
    expect(unresolved.length).toBeGreaterThanOrEqual(1);
    expect(unresolved.some((d) => d.message.includes("does-not-exist.yaml"))).toBe(true);
  });

  test("missing pointer produces an unresolved-ref diagnostic from resolveRef", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/misc/unresolved.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const entryDoc = graph.documents.get(entry)!;

    const result = resolveRef(graph, entryDoc, "#/components/schemas/NoSuchThing");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected unresolved ref");
    expect(result.diagnostic.code).toBe("no-unresolved-ref");
  });
});

describe("InMemoryFileSystem workspace graph", () => {
  test("resolves refs across in-memory buffers", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": "openapi: 3.0.3\ncomponents:\n  schemas:\n    Foo:\n      $ref: './foo.yaml#/Foo'\n",
      "/virtual/foo.yaml": "Foo:\n  type: string\n",
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    expect(graph.documents.size).toBe(2);

    const entryDoc = graph.documents.get("/virtual/entry.yaml")!;
    const result = resolveRef(graph, entryDoc, "./foo.yaml#/Foo");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected resolved ref");
    expect(isMap(result.node) && isScalar((result.node as YAMLMap).items[0]?.value)).toBe(true);
  });
});
