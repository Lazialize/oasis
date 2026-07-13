import { describe, expect, test } from "bun:test";
import { isMap, isScalar } from "yaml";
import type { YAMLMap } from "yaml";
import { buildAnchorIndex } from "../src/anchor.ts";
import { InMemoryFileSystem, NodeFileSystem } from "../src/filesystem.ts";
import { allDiagnostics, loadWorkspaceGraph } from "../src/graph.ts";
import { resolveRef } from "../src/ref.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

/** The scalar value of `type` on a resolved schema map, for asserting which anchor we landed on. */
function typeOf(node: unknown): string | undefined {
  if (!isMap(node)) return undefined;
  const pair = (node as YAMLMap).items.find((p) => isScalar(p.key) && p.key.value === "type");
  return pair && isScalar(pair.value) ? String(pair.value.value) : undefined;
}

describe("JSON Schema anchors in OpenAPI 3.1 (issue #26)", () => {
  test("indexes $anchor, $dynamicAnchor and nested-$id anchors", async () => {
    const fs = new NodeFileSystem();
    const graph = await loadWorkspaceGraph(fs, `${fixturesRoot}/anchors31/entry.yaml`);
    const doc = [...graph.documents.values()][0]!;
    const index = buildAnchorIndex(doc);

    expect([...index.byName.keys()].sort()).toEqual(["DynItem", "Encoded", "NestedAnchor", "PlainName"]);
    expect(index.byName.get("DynItem")!.dynamic).toBe(true);
    expect(index.byName.get("PlainName")!.dynamic).toBe(false);
    // The nested-$id anchor records the enclosing $id scope.
    expect(index.byName.get("NestedAnchor")!.scope).toBe("nested/scope");
    expect(index.byName.get("PlainName")!.scope).toBe("https://example.com/root");
  });

  test("resolves a plain-name #anchor reference to its schema", async () => {
    const fs = new NodeFileSystem();
    const graph = await loadWorkspaceGraph(fs, `${fixturesRoot}/anchors31/entry.yaml`);
    const doc = graph.documents.get(`${fixturesRoot}/anchors31/entry.yaml`)!;

    const plain = resolveRef(graph, doc, "#PlainName");
    expect(plain.ok).toBe(true);
    if (plain.ok) expect(typeOf(plain.node)).toBe("string");

    const dyn = resolveRef(graph, doc, "#DynItem");
    expect(dyn.ok).toBe(true);
    if (dyn.ok) expect(typeOf(dyn.node)).toBe("integer");

    const nested = resolveRef(graph, doc, "#NestedAnchor");
    expect(nested.ok).toBe(true);
    if (nested.ok) expect(typeOf(nested.node)).toBe("boolean");
  });

  test("percent-decodes an anchor fragment before lookup", async () => {
    const fs = new NodeFileSystem();
    const graph = await loadWorkspaceGraph(fs, `${fixturesRoot}/anchors31/entry.yaml`);
    const doc = graph.documents.get(`${fixturesRoot}/anchors31/entry.yaml`)!;

    // #%45ncoded decodes to #Encoded
    const encoded = resolveRef(graph, doc, "#%45ncoded");
    expect(encoded.ok).toBe(true);
    if (encoded.ok) expect(typeOf(encoded.node)).toBe("number");
  });

  test("an unknown anchor is an unresolved reference, not a property lookup", async () => {
    const fs = new NodeFileSystem();
    const graph = await loadWorkspaceGraph(fs, `${fixturesRoot}/anchors31/entry.yaml`);
    const doc = graph.documents.get(`${fixturesRoot}/anchors31/entry.yaml`)!;

    const missing = resolveRef(graph, doc, "#NoSuchAnchor");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.diagnostic.message).toContain("anchor");
  });

  test("3.0 documents have an empty anchor index (anchors are a 3.1 feature)", () => {
    const fs = new InMemoryFileSystem({
      "/v/entry.yaml": ["openapi: 3.0.3", "components:", "  schemas:", "    A:", "      $anchor: Nope"].join("\n"),
    });
    // parseDocument is reached through the graph; simplest is to load and inspect.
    return loadWorkspaceGraph(fs, "/v/entry.yaml").then((graph) => {
      const doc = graph.documents.get("/v/entry.yaml")!;
      expect(buildAnchorIndex(doc).byName.size).toBe(0);
    });
  });
});

describe("external URI references (issue #26)", () => {
  test("an https $ref is not routed through the filesystem (no bogus load failure)", async () => {
    const fs = new InMemoryFileSystem({
      "/v/entry.yaml": [
        "openapi: 3.1.0",
        "info: { title: t, version: '1' }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Ext:",
        "      $ref: 'https://example.com/other.json#/$defs/Thing'",
      ].join("\n"),
    });
    const graph = await loadWorkspaceGraph(fs, "/v/entry.yaml");

    // Only the entry is loaded; the external URI never becomes a file lookup.
    expect(graph.documents.size).toBe(1);
    expect(graph.diagnostics.filter((d) => d.message.includes("Failed to load"))).toEqual([]);
  });

  test("resolveRef reports an external URI as an unsupported external reference", async () => {
    const fs = new InMemoryFileSystem({
      "/v/entry.yaml": ["openapi: 3.1.0", "info: { title: t, version: '1' }", "paths: {}"].join("\n"),
    });
    const graph = await loadWorkspaceGraph(fs, "/v/entry.yaml");
    const doc = graph.documents.get("/v/entry.yaml")!;

    const result = resolveRef(graph, doc, "urn:example:foo#/bar");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.message).toContain("external");
    void allDiagnostics(graph);
  });
});
