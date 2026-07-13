import { describe, expect, test } from "bun:test";
import { isMap, isScalar } from "yaml";
import type { YAMLMap } from "yaml";
import { NodeFileSystem, InMemoryFileSystem } from "../src/filesystem.ts";
import { allDiagnostics, loadWorkspaceGraph } from "../src/graph.ts";
import { findRefs, resolveRef } from "../src/ref.ts";
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

describe("percent-encoded $ref file part", () => {
  test("a %20-encoded file part resolves to the real (space-containing) file name", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/percent-encoded/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const entryDoc = graph.documents.get(entry)!;

    const result = resolveRef(graph, entryDoc, "./petstore%20v2.yaml#/components/schemas/Pet");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected resolved ref");
    expect(result.doc.filePath).toBe(`${fixturesRoot}/percent-encoded/petstore v2.yaml`);
    expect(isMap(result.node)).toBe(true);
  });

  test("a malformed percent-encoding in the file part does not throw; it's an unresolved ref instead", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/percent-encoded/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const entryDoc = graph.documents.get(entry)!;

    let result: ReturnType<typeof resolveRef> | undefined;
    expect(() => {
      result = resolveRef(graph, entryDoc, "./bad%.yaml#/x");
    }).not.toThrow();
    expect(result!.ok).toBe(false);
  });
});

describe("$ref-as-literal-data is not treated as a reference", () => {
  test("findRefs skips $ref nested under example/default/enum literal data", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.0.3",
        "components:",
        "  schemas:",
        "    Foo:",
        "      type: object",
        "      example:",
        "        $ref: './does-not-exist.yaml'",
        "      default:",
        "        $ref: './also-missing.yaml'",
        "      enum:",
        "        - $ref: './enum-missing.yaml'",
        "        - plain",
        "      properties:",
        "        bar:",
        "          $ref: '#/components/schemas/Foo'",
        "",
      ].join("\n"),
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");

    // Only the real ref (under `properties/bar`) should have been discovered/loaded; the
    // literal-data $refs must not trigger a (spurious) load attempt or diagnostic.
    expect(graph.documents.size).toBe(1);
    expect(allDiagnostics(graph)).toEqual([]);

    const entryDoc = graph.documents.get("/virtual/entry.yaml")!;
    const found = findRefs(entryDoc);
    expect(found).toHaveLength(1);
    expect(found[0]?.value).toBe("#/components/schemas/Foo");
  });
});

describe("container entries named like literal-data keywords are still references", () => {
  test("responses.default, examples-map entries, and a property named `default` are found; schema-level example/default/enum stay literal", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.0.3",
        "paths:",
        "  /pets:",
        "    get:",
        "      responses:",
        "        '200':",
        "          description: ok",
        "          content:",
        "            application/json:",
        "              schema:",
        "                $ref: '#/components/schemas/Pet'",
        "              examples:",
        "                default:",
        "                  $ref: '#/components/examples/PetExample'",
        "                example:",
        "                  $ref: '#/components/examples/OtherExample'",
        "        default:",
        "          $ref: '#/components/responses/NotFound'",
        "components:",
        "  schemas:",
        "    Pet:",
        "      type: object",
        "      properties:",
        // A schema property literally named `default` is a Schema Object with a real $ref.
        "        default:",
        "          $ref: '#/components/schemas/Fallback'",
        "    Fallback:",
        "      type: string",
        // Genuine literal data: the $ref-shaped values here are plain instance data, not refs.
        "      default:",
        "        $ref: './not-a-ref.yaml'",
        "      example:",
        "        $ref: './also-not.yaml'",
        "      enum:",
        "        - $ref: './nope.yaml'",
      ].join("\n"),
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const entryDoc = graph.documents.get("/virtual/entry.yaml")!;
    const values = findRefs(entryDoc).map((r) => r.value).sort();

    expect(values).toEqual(
      [
        "#/components/examples/OtherExample",
        "#/components/examples/PetExample",
        "#/components/responses/NotFound",
        "#/components/schemas/Fallback",
        "#/components/schemas/Pet",
      ].sort(),
    );
    // The literal-data $refs (under schema-level default/example/enum) are NOT among them.
    expect(values.some((v) => v.endsWith(".yaml"))).toBe(false);
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
