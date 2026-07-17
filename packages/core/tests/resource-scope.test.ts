import { describe, expect, test } from "bun:test";
import { isMap, isScalar } from "yaml";
import { InMemoryFileSystem } from "../src/filesystem.ts";
import { allDiagnostics, graphReferences, loadWorkspaceGraph } from "../src/graph.ts";
import { resolveRef } from "../src/ref.ts";

function typeOf(node: unknown): string | undefined {
  if (!isMap(node)) return undefined;
  const pair = node.items.find((item) => isScalar(item.key) && item.key.value === "type");
  return pair && isScalar(pair.value) ? String(pair.value.value) : undefined;
}

describe("JSON Schema resource-scoped resolution (issue #92)", () => {
  test("resolves a relative ref from the nearest nested $id resource", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "info: { title: t, version: '1' }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Scoped:",
        "      $id: ./scope/root.json",
        "      $defs:",
        "        Child:",
        "          $ref: child.yaml",
      ].join("\n"),
      "/api/scope/child.yaml": "type: string\n",
    });

    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const entry = graph.documents.get("/api/entry.yaml")!;
    const childRef = graphReferences(graph, entry).find((ref) => ref.value === "child.yaml")!;

    expect([...graph.documents.keys()].sort()).toEqual(["/api/entry.yaml", "/api/scope/child.yaml"]);
    expect(allDiagnostics(graph)).toEqual([]);
    const resolved = resolveRef(graph, entry, childRef);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(typeOf(resolved.node)).toBe("string");
  });

  test("indexes an anchor in a standalone schema reached from a 3.1 Schema Object", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "info: { title: t, version: '1' }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Thing: { $ref: './schema.yaml#Thing' }",
      ].join("\n"),
      "/api/schema.yaml": ["$schema: https://json-schema.org/draft/2020-12/schema", "$anchor: Thing", "type: integer"].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const entry = graph.documents.get("/api/entry.yaml")!;
    const ref = graphReferences(graph, entry).find((candidate) => candidate.value === "./schema.yaml#Thing")!;

    expect(allDiagnostics(graph)).toEqual([]);
    const resolved = resolveRef(graph, entry, ref);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(typeOf(resolved.node)).toBe("integer");
      expect(resolved.range.filePath).toBe("/api/schema.yaml");
      expect(resolved.range.start.line).toBe(0);
      expect(resolved.range.start.character).toBe(0);
      expect(resolved.range.end.line).toBe(2);
      expect(resolved.range.end.character).toBe(13);
    }
  });

  test("resolves root and nested relative $id values before following relative refs", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "info: { title: t, version: '1' }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Scoped:",
        "      $id: ./resources/root.json",
        "      $defs:",
        "        Nested:",
        "          $id: nested/child.json",
        "          $ref: target.yaml",
      ].join("\n"),
      "/api/resources/nested/target.yaml": ["$anchor: Target", "type: boolean"].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const entry = graph.documents.get("/api/entry.yaml")!;
    const ref = graphReferences(graph, entry).find((candidate) => candidate.value === "target.yaml")!;

    expect([...graph.documents.keys()].sort()).toEqual(["/api/entry.yaml", "/api/resources/nested/target.yaml"]);
    expect(allDiagnostics(graph)).toEqual([]);
    const resolved = resolveRef(graph, entry, ref);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(typeOf(resolved.node)).toBe("boolean");
  });

  test("does not apply the JSON Pointer target's $id twice when scanning its refs", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    Root: { $ref: './schema.yaml#/Nested' }",
      ].join("\n"),
      "/api/schema.yaml": [
        "Nested:",
        "  $id: scoped/root.json",
        "  $ref: child.yaml",
      ].join("\n"),
      "/api/scoped/child.yaml": "type: string\n",
    });

    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const schemaDoc = graph.documents.get("/api/schema.yaml")!;
    const childRef = graphReferences(graph, schemaDoc).find((candidate) => candidate.value === "child.yaml")!;

    expect([...graph.documents.keys()].sort()).toEqual([
      "/api/entry.yaml",
      "/api/schema.yaml",
      "/api/scoped/child.yaml",
    ]);
    expect(childRef.baseUri).toBe("file:///api/scoped/root.json");
    expect(allDiagnostics(graph)).toEqual([]);
    const resolved = resolveRef(graph, schemaDoc, childRef);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.doc.filePath).toBe("/api/scoped/child.yaml");
  });

  test("does not apply a whole-document schema root's $id twice when scanning its refs", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    Root: { $ref: './schema.yaml' }",
      ].join("\n"),
      "/api/schema.yaml": [
        "$id: scoped/root.json",
        "$ref: child.yaml",
      ].join("\n"),
      "/api/scoped/child.yaml": "type: integer\n",
    });

    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const schemaDoc = graph.documents.get("/api/schema.yaml")!;
    const childRef = graphReferences(graph, schemaDoc).find((candidate) => candidate.value === "child.yaml")!;

    expect([...graph.documents.keys()].sort()).toEqual([
      "/api/entry.yaml",
      "/api/schema.yaml",
      "/api/scoped/child.yaml",
    ]);
    expect(childRef.baseUri).toBe("file:///api/scoped/root.json");
    expect(allDiagnostics(graph)).toEqual([]);
    const resolved = resolveRef(graph, schemaDoc, childRef);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.doc.filePath).toBe("/api/scoped/child.yaml");
  });

  test("keeps the same anchor name distinct between embedded schema resources", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "info: { title: t, version: '1' }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    One:",
        "      $id: one.json",
        "      $defs:",
        "        Value: { $anchor: Same, type: string }",
        "        Use: { $ref: '#Same' }",
        "    Two:",
        "      $id: two.json",
        "      $defs:",
        "        Value: { $anchor: Same, type: integer }",
        "        Use: { $ref: '#Same' }",
      ].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const entry = graph.documents.get("/api/entry.yaml")!;
    const refs = graphReferences(graph, entry).filter((candidate) => candidate.value === "#Same");

    expect(refs).toHaveLength(2);
    expect(allDiagnostics(graph)).toEqual([]);
    const resolved = refs.map((ref) => resolveRef(graph, entry, ref));
    expect(resolved.every((result) => result.ok)).toBe(true);
    expect(resolved.map((result) => result.ok ? typeOf(result.node) : undefined)).toEqual(["string", "integer"]);
    if (resolved[0]?.ok && resolved[1]?.ok) {
      expect(resolved[0].range.start.line).toBe(8);
      expect(resolved[0].range.start.character).toBe(15);
      expect(resolved[1].range.start.line).toBe(13);
      expect(resolved[1].range.start.character).toBe(15);
    }
  });

  test("resolves an aliased ref separately in each resource scope", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "info: { title: t, version: '1' }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Shared: &shared",
        "      $ref: target.yaml",
        "    One:",
        "      $id: one/root.json",
        "      $defs: { Use: *shared }",
        "    Two:",
        "      $id: two/root.json",
        "      $defs: { Use: *shared }",
      ].join("\n"),
      "/api/target.yaml": "type: 'null'\n",
      "/api/one/target.yaml": "type: string\n",
      "/api/two/target.yaml": "type: integer\n",
    });

    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const entry = graph.documents.get("/api/entry.yaml")!;
    const refs = graphReferences(graph, entry).filter((candidate) => candidate.value === "target.yaml");

    expect(refs).toHaveLength(3);
    expect(allDiagnostics(graph)).toEqual([]);
    expect(refs.map((ref) => resolveRef(graph, entry, ref)).map((result) =>
      result.ok ? typeOf(result.node) : undefined
    )).toEqual(["null", "string", "integer"]);
  });

  test("retains resource context for a scalar-aliased ref value", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "x-child-ref: &childRef child.yaml",
        "components:",
        "  schemas:",
        "    Root:",
        "      $id: scoped/root.json",
        "      $defs:",
        "        Use: { $ref: *childRef }",
      ].join("\n"),
      "/api/scoped/child.yaml": "type: string\n",
    });

    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const entry = graph.documents.get("/api/entry.yaml")!;
    const ref = graphReferences(graph, entry).find((candidate) => candidate.value === "child.yaml")!;

    expect(ref.baseUri).toBe("file:///api/scoped/root.json");
    const resolved = resolveRef(graph, entry, ref);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.doc.filePath).toBe("/api/scoped/child.yaml");
  });

  test("indexes an embedded resource in an Encoding Object header schema", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "paths:",
        "  /items:",
        "    get:",
        "      responses:",
        "        '200':",
        "          description: ok",
        "          content:",
        "            application/json:",
        "              schema: { type: object, properties: { payload: { type: string } } }",
        "              encoding:",
        "                payload:",
        "                  headers:",
        "                    X-Trace:",
        "                      schema:",
        "                        $id: scopes/header.json",
        "                        $defs:",
        "                          Target: { $anchor: target, type: string }",
        "                        $ref: '#target'",
      ].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const entry = graph.documents.get("/api/entry.yaml")!;
    const ref = graphReferences(graph, entry).find((candidate) => candidate.value === "#target")!;

    expect(ref.baseUri).toBe("file:///api/scopes/header.json");
    expect(graph.resources.has("file:///api/scopes/header.json")).toBe(true);
    const resolved = resolveRef(graph, entry, ref);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(typeOf(resolved.node)).toBe("string");
  });

  test("resolves a JSON Pointer from an embedded resource root", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    Root:",
        "      $id: nested/root.json",
        "      $defs:",
        "        Target: { type: number }",
        "        Use: { $ref: '#/$defs/Target' }",
      ].join("\n"),
    });
    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const entry = graph.documents.get("/api/entry.yaml")!;
    const ref = graphReferences(graph, entry).find((candidate) => candidate.value === "#/$defs/Target")!;
    const resolved = resolveRef(graph, entry, ref);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(typeOf(resolved.node)).toBe("number");
  });

  test("does not route a relative ref under an https $id through the physical filesystem", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    Root:",
        "      $id: https://schemas.example/root.json",
        "      $ref: child.yaml",
      ].join("\n"),
      "/api/child.yaml": "type: string\n",
    });
    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const entry = graph.documents.get("/api/entry.yaml")!;
    const ref = graphReferences(graph, entry).find((candidate) => candidate.value === "child.yaml")!;
    expect([...graph.documents.keys()]).toEqual(["/api/entry.yaml"]);
    const resolved = resolveRef(graph, entry, ref);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.diagnostic.message).toContain("external");
  });

  test("keeps discriminator mappings document-relative outside schema $id scope", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    Root:",
        "      $id: scoped/root.json",
        "      discriminator:",
        "        propertyName: kind",
        "        mapping: { dog: './dog.yaml#/Dog' }",
      ].join("\n"),
      "/api/dog.yaml": "Dog: { type: string }\n",
    });
    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    expect([...graph.documents.keys()].sort()).toEqual(["/api/dog.yaml", "/api/entry.yaml"]);
  });

  test("indexes schema anchors below x-prefixed webhook names", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "webhooks:",
        "  x-hook:",
        "    post:",
        "      requestBody:",
        "        content:",
        "          application/json:",
        "            schema:",
        "              $defs:",
        "                Value: { $anchor: HookValue, type: boolean }",
        "              $ref: '#HookValue'",
      ].join("\n"),
    });
    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const entry = graph.documents.get("/api/entry.yaml")!;
    const ref = graphReferences(graph, entry).find((candidate) => candidate.value === "#HookValue")!;
    const resolved = resolveRef(graph, entry, ref);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(typeOf(resolved.node)).toBe("boolean");
  });

  test("indexes anchors in schemas of inline parameter sequence entries", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "paths:",
        "  /things:",
        "    parameters:",
        "      - name: filter",
        "        in: query",
        "        schema:",
        "          $defs:",
        "            Value: { $anchor: ParamValue, type: string }",
        "          $ref: '#ParamValue'",
      ].join("\n"),
    });
    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const entry = graph.documents.get("/api/entry.yaml")!;
    const ref = graphReferences(graph, entry).find((candidate) => candidate.value === "#ParamValue")!;
    const resolved = resolveRef(graph, entry, ref);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(typeOf(resolved.node)).toBe("string");
  });

  test("retains a root $id base after entering an external subschema by JSON Pointer", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    Root: { $ref: './schema.yaml#/$defs/Foo' }",
      ].join("\n"),
      "/api/schema.yaml": [
        "$id: scope/root.json",
        "$defs:",
        "  Foo: { $ref: child.yaml }",
      ].join("\n"),
      "/api/scope/child.yaml": "type: boolean\n",
    });
    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const schemaDoc = graph.documents.get("/api/schema.yaml")!;
    const childRef = graphReferences(graph, schemaDoc).find((candidate) => candidate.value === "child.yaml")!;

    expect([...graph.documents.keys()].sort()).toEqual([
      "/api/entry.yaml",
      "/api/schema.yaml",
      "/api/scope/child.yaml",
    ]);
    expect(childRef.baseUri).toBe("file:///api/scope/root.json");
    const resolved = resolveRef(graph, schemaDoc, childRef);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(typeOf(resolved.node)).toBe("boolean");
  });

  test("restores the nearest nested $id after entering its descendant by JSON Pointer", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    Root: { $ref: './schema.yaml#/$defs/Nested/$defs/Foo' }",
      ].join("\n"),
      "/api/schema.yaml": [
        "$id: scope/root.json",
        "$defs:",
        "  Nested:",
        "    $id: nested/child.json",
        "    $defs:",
        "      Foo: { $ref: target.yaml }",
      ].join("\n"),
      "/api/scope/nested/target.yaml": "type: integer\n",
    });
    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const schemaDoc = graph.documents.get("/api/schema.yaml")!;
    const targetRef = graphReferences(graph, schemaDoc).find((candidate) => candidate.value === "target.yaml")!;

    expect([...graph.documents.keys()].sort()).toEqual([
      "/api/entry.yaml",
      "/api/schema.yaml",
      "/api/scope/nested/target.yaml",
    ]);
    expect(targetRef.baseUri).toBe("file:///api/scope/nested/child.json");
    const resolved = resolveRef(graph, schemaDoc, targetRef);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(typeOf(resolved.node)).toBe("integer");
  });

  test("uses the pointer occurrence to disambiguate an aliased subschema resource", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    Root: { $ref: './schema.yaml#/$defs/One/$defs/Use' }",
      ].join("\n"),
      "/api/schema.yaml": [
        "$id: root.json",
        "$defs:",
        "  Shared: &shared { $ref: target.yaml }",
        "  One:",
        "    $id: one/root.json",
        "    $defs: { Use: *shared }",
        "  Two:",
        "    $id: two/root.json",
        "    $defs: { Use: *shared }",
      ].join("\n"),
      "/api/one/target.yaml": "type: string\n",
    });
    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const schemaDoc = graph.documents.get("/api/schema.yaml")!;
    const ref = graphReferences(graph, schemaDoc).find((candidate) => candidate.value === "target.yaml")!;

    expect([...graph.documents.keys()].sort()).toEqual([
      "/api/entry.yaml",
      "/api/one/target.yaml",
      "/api/schema.yaml",
    ]);
    expect(ref.baseUri).toBe("file:///api/one/root.json");
    const resolved = resolveRef(graph, schemaDoc, ref);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(typeOf(resolved.node)).toBe("string");
  });

  test("does not fall back to a physical sibling when a scoped target is missing", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    Scoped: { $id: scope/root.json, $ref: child.yaml }",
        "    Physical: { $ref: child.yaml }",
      ].join("\n"),
      "/api/child.yaml": "type: integer\n",
    });
    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const entry = graph.documents.get("/api/entry.yaml")!;
    const refs = graphReferences(graph, entry).filter((candidate) => candidate.value === "child.yaml");

    expect(refs).toHaveLength(2);
    const scoped = resolveRef(graph, entry, refs[0]!);
    const physical = resolveRef(graph, entry, refs[1]!);
    expect(scoped.ok).toBe(false);
    if (!scoped.ok) expect(scoped.diagnostic.message).toContain("file:///api/scope/child.yaml");
    expect(physical.ok).toBe(true);
    if (physical.ok) expect(typeOf(physical.node)).toBe("integer");
  });

  test("ignores a lookalike $id on an external non-schema object", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  parameters:",
        "    Filter: { $ref: parameter.yaml }",
      ].join("\n"),
      "/api/parameter.yaml": [
        "$id: bogus/root.json",
        "name: filter",
        "in: query",
        "schema: { $ref: child.yaml }",
      ].join("\n"),
      "/api/child.yaml": "type: string\n",
    });
    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");
    const parameterDoc = graph.documents.get("/api/parameter.yaml")!;
    const ref = graphReferences(graph, parameterDoc).find((candidate) => candidate.value === "child.yaml")!;

    expect(ref.baseUri).toBe("file:///api/parameter.yaml");
    expect([...graph.documents.keys()].sort()).toEqual([
      "/api/child.yaml",
      "/api/entry.yaml",
      "/api/parameter.yaml",
    ]);
    const resolved = resolveRef(graph, parameterDoc, ref);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(typeOf(resolved.node)).toBe("string");
  });
});
