import { describe, expect, test } from "bun:test";
import { isMap, isScalar } from "yaml";
import type { YAMLMap } from "yaml";
import { NodeFileSystem, InMemoryFileSystem } from "../src/filesystem.ts";
import { allDiagnostics, loadWorkspaceGraph } from "../src/graph.ts";
import { findRefs, parseRefString, resolveRef } from "../src/ref.ts";
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
  test("parseRefString preserves the raw file part for URI classification", () => {
    expect(parseRefString("foo%3Abar.yaml#/Foo")).toEqual({
      filePart: "foo%3Abar.yaml",
      pointer: "/Foo",
    });
  });

  test("FileSystem.resolve keeps native percent characters literal", () => {
    for (const fs of [new NodeFileSystem(), new InMemoryFileSystem()]) {
      expect(fs.resolve("/virtual/oasis.config.jsonc", "foo%20.yaml")).toBe("/virtual/foo%20.yaml");
    }
  });

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

  test("relative encoded delimiters and Unicode are decoded only after URI classification", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    Colon: { $ref: 'foo%3Abar.yaml#/Foo' }",
        "    Hash: { $ref: 'hash%23name.yaml#/Hash' }",
        "    Percent: { $ref: 'percent%25name.yaml#/Percent' }",
        "    Unicode: { $ref: 'caf%C3%A9.yaml#/Unicode' }",
      ].join("\n"),
      "/virtual/foo:bar.yaml": "Foo: { type: string }\n",
      "/virtual/hash#name.yaml": "Hash: { type: string }\n",
      "/virtual/percent%name.yaml": "Percent: { type: string }\n",
      "/virtual/café.yaml": "Unicode: { type: string }\n",
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const entryDoc = graph.documents.get("/virtual/entry.yaml")!;

    expect(graph.documents.size).toBe(5);
    expect(allDiagnostics(graph)).toEqual([]);
    for (const ref of [
      "foo%3Abar.yaml#/Foo",
      "hash%23name.yaml#/Hash",
      "percent%25name.yaml#/Percent",
      "caf%C3%A9.yaml#/Unicode",
    ]) {
      expect(resolveRef(graph, entryDoc, ref).ok).toBe(true);
    }
  });

  test("file URLs use URL path semantics in both filesystem implementations", async () => {
    const nodeFs = new NodeFileSystem();
    const entry = `${fixturesRoot}/percent-encoded/entry.yaml`;
    const fileUrl = new URL("./fixtures/percent-encoded/petstore%20v2.yaml", import.meta.url).href;
    const graph = await loadWorkspaceGraph(nodeFs, entry);
    const entryDoc = graph.documents.get(entry)!;
    const nodeResult = resolveRef(graph, entryDoc, `${fileUrl}#/components/schemas/Pet`);

    expect(nodeResult.ok).toBe(true);
    if (!nodeResult.ok) throw new Error("expected resolved file URL");
    expect(nodeResult.doc.filePath).toBe(`${fixturesRoot}/percent-encoded/petstore v2.yaml`);

    const memoryFs = new InMemoryFileSystem({
      "/virtual/entry.yaml": "openapi: 3.1.0\ncomponents:\n  schemas:\n    Foo:\n      $ref: 'file:///virtual/ext%20file.yaml#/Foo'\n",
      "/virtual/ext file.yaml": "Foo: { type: string }\n",
    });
    const memoryGraph = await loadWorkspaceGraph(memoryFs, "/virtual/entry.yaml");
    const memoryDoc = memoryGraph.documents.get("/virtual/entry.yaml")!;

    expect(memoryGraph.documents.has("/virtual/ext file.yaml")).toBe(true);
    expect(resolveRef(memoryGraph, memoryDoc, "file:///virtual/ext%20file.yaml#/Foo").ok).toBe(true);
    expect(resolveRef(memoryGraph, memoryDoc, "file://localhost/virtual/ext%20file.yaml#/Foo").ok).toBe(true);
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

  test("skips $ref-shaped data in Example.value and Link Any-valued fields", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  examples:",
        "    Payload:",
        "      value:",
        "        $ref: './literal-only.yaml#/ExampleValue'",
        "    Referenced:",
        "      $ref: './targets.yaml#/Example'",
        "    WholeFile:",
        "      $ref: './whole-example.yaml'",
        "  links:",
        "    Next:",
        "      operationId: receive",
        "      parameters:",
        "        payload:",
        "          $ref: './literal-only.yaml#/ParameterValue'",
        "      requestBody:",
        "        $ref: './literal-only.yaml#/RequestBodyValue'",
        "    Referenced:",
        "      $ref: './targets.yaml#/Link'",
      ].join("\n"),
      "/virtual/targets.yaml": [
        "Example:",
        "  value: { $ref: './literal-example.yaml#/X' }",
        "Link:",
        "  operationId: receive",
        "  requestBody: { $ref: './literal-link.yaml#/X' }",
      ].join("\n"),
      "/virtual/whole-example.yaml": "value: { $ref: './literal-whole.yaml#/X' }",
      "/virtual/literal-example.yaml": "X: { ignored: true }",
      "/virtual/literal-link.yaml": "X: { ignored: true }",
      "/virtual/literal-whole.yaml": "X: { ignored: true }",
    });

    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const entryDoc = graph.documents.get("/virtual/entry.yaml")!;

    expect(graph.documents.size).toBe(3);
    expect(allDiagnostics(graph)).toEqual([]);
    expect(findRefs(entryDoc).map((ref) => ref.value)).toEqual([
      "./targets.yaml#/Example",
      "./whole-example.yaml",
      "./targets.yaml#/Link",
    ]);
  });

  test("missing files named only by external Any payloads produce no diagnostics", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  examples:",
        "    E: { $ref: './example.yaml' }",
        "  links:",
        "    L: { $ref: './targets.yaml#/Link' }",
      ].join("\n"),
      "/virtual/example.yaml": "value: { $ref: './missing-example.yaml#/X' }",
      "/virtual/targets.yaml": [
        "Link:",
        "  operationId: receive",
        "  parameters:",
        "    payload: { $ref: './missing-parameter.yaml#/X' }",
        "  requestBody: { $ref: './missing-body.yaml#/X' }",
      ].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");

    expect(graph.documents.size).toBe(3);
    expect(allDiagnostics(graph)).toEqual([]);
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

describe("discriminator.mapping values are references", () => {
  test("an aliased discriminator.mapping map retains reference semantics", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.0.3",
        "components:",
        "  schemas:",
        "    Pet:",
        "      type: object",
        "      x-shared-mapping: &petMapping",
        "        dog: './dog.yaml#/Dog'",
        "      discriminator:",
        "        propertyName: petType",
        "        mapping: *petMapping",
      ].join("\n"),
      "/virtual/dog.yaml": "Dog:\n  type: object\n",
    });

    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    expect([...graph.documents.keys()].sort()).toEqual(["/virtual/dog.yaml", "/virtual/entry.yaml"]);
    expect(allDiagnostics(graph)).toEqual([]);
    expect(findRefs(graph.documents.get("/virtual/entry.yaml")!).map((ref) => ref.value)).toEqual([
      "./dog.yaml#/Dog",
    ]);
  });

  test("an aliased discriminator.mapping scalar retains its target value and source range", async () => {
    const entry = "/virtual/entry.yaml";
    const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
      [entry]: [
        "openapi: 3.0.3",
        "components:",
        "  schemas:",
        "    Source:",
        "      default: &dogUri './dog.yaml#/Dog'",
        "    Pet:",
        "      discriminator:",
        "        propertyName: petType",
        "        mapping:",
        "          dog: *dogUri",
      ].join("\n"),
      "/virtual/dog.yaml": "Dog:\n  type: object\n",
    }), entry);

    expect(graph.documents.has("/virtual/dog.yaml")).toBe(true);
    expect(allDiagnostics(graph)).toEqual([]);
    const refs = findRefs(graph.documents.get(entry)!);
    expect(refs.map((ref) => ref.value)).toEqual(["./dog.yaml#/Dog"]);
    expect(refs[0]?.range.start.line).toBe(4);
  });

  test("a mapping value shaped like a $ref (file+pointer) is found by findRefs and its file is loaded into the workspace graph, even when nothing else references that file", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.0.3",
        "components:",
        "  schemas:",
        "    Pet:",
        "      type: object",
        "      discriminator:",
        "        propertyName: petType",
        "        mapping:",
        "          dog: './dog.yaml#/Dog'",
        "          cat: Cat", // bare component name: must be left alone
        "      oneOf:",
        "        - $ref: '#/components/schemas/Cat'",
        "    Cat:",
        "      type: object",
      ].join("\n"),
      "/virtual/dog.yaml": "Dog:\n  type: object\n",
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");

    // dog.yaml is referenced only from the mapping (no sibling $ref anywhere) but must still be
    // loaded into the workspace graph.
    expect(graph.documents.size).toBe(2);
    expect(graph.documents.has("/virtual/dog.yaml")).toBe(true);
    expect(allDiagnostics(graph)).toEqual([]);

    const entryDoc = graph.documents.get("/virtual/entry.yaml")!;
    const values = findRefs(entryDoc).map((r) => r.value).sort();
    expect(values).toEqual(["#/components/schemas/Cat", "./dog.yaml#/Dog"].sort());
    // The bare component name "Cat" mapping value must NOT show up as a discovered ref.
    expect(values.includes("Cat")).toBe(false);
  });

  test("a same-document pointer mapping value is found and resolves", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.0.3",
        "components:",
        "  schemas:",
        "    Pet:",
        "      type: object",
        "      discriminator:",
        "        propertyName: petType",
        "        mapping:",
        "          cat: '#/components/schemas/Cat'",
        "      oneOf:",
        "        - $ref: '#/components/schemas/Cat'",
        "    Cat:",
        "      type: object",
      ].join("\n"),
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const entryDoc = graph.documents.get("/virtual/entry.yaml")!;
    const values = findRefs(entryDoc).map((r) => r.value);
    expect(values.filter((v) => v === "#/components/schemas/Cat")).toHaveLength(2); // oneOf + mapping

    const result = resolveRef(graph, entryDoc, "#/components/schemas/Cat");
    expect(result.ok).toBe(true);
  });

  test("a mapping value that is not under a key literally named 'mapping' is unaffected (sanity: no false positives)", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.0.3",
        "components:",
        "  schemas:",
        "    Foo:",
        "      type: object",
        "      properties:",
        // A property literally named "mapping" whose value happens to look ref-like is plain data,
        // not a discriminator mapping, and must not be treated as a reference.
        "        mapping:",
        "          type: string",
        "          example: './not-a-ref.yaml#/x'",
      ].join("\n"),
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    expect(graph.documents.size).toBe(1);
    expect(allDiagnostics(graph)).toEqual([]);
  });
});

test("a $ref scalar Alias is discovered using the anchor target's value and range", async () => {
  const entry = "/virtual/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.0.3",
      "components:",
      "  schemas:",
      "    Source:",
      "      default: &schemaUri './external.yaml#/External'",
      "    Matrix:",
      "      $ref: *schemaUri",
    ].join("\n"),
    "/virtual/external.yaml": "External:\n  type: string\n",
  }), entry);

  expect(graph.documents.has("/virtual/external.yaml")).toBe(true);
  expect(allDiagnostics(graph)).toEqual([]);
  const refs = findRefs(graph.documents.get(entry)!);
  expect(refs.map((ref) => ref.value)).toEqual(["./external.yaml#/External"]);
  expect(refs[0]?.range.start.line).toBe(4);
});

test("an aliased Schema examples sequence remains literal instance data", async () => {
  const entry = "/virtual/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "components:",
      "  schemas:",
      "    Source:",
      "      type: array",
      "      default: &values",
      "        - $ref: './ghost.yaml#/Literal'",
      "    Matrix:",
      "      type: array",
      "      examples: *values",
    ].join("\n"),
  }), entry);

  expect([...graph.documents.keys()]).toEqual([entry]);
  expect(allDiagnostics(graph)).toEqual([]);
  expect(findRefs(graph.documents.get(entry)!)).toEqual([]);
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

describe("failed-load negative cache", () => {
  test("a missing file referenced from multiple sites yields one diagnostic", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.0.3",
        "components:",
        "  schemas:",
        "    A:",
        "      $ref: './missing.yaml#/components/schemas/X'",
        "    B:",
        "      $ref: './missing.yaml#/components/schemas/Y'",
        "",
      ].join("\n"),
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const loadFailures = graph.diagnostics.filter((d) => d.message.includes("Failed to load"));
    expect(loadFailures).toHaveLength(1);
  });
});
