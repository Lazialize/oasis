import { expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { bundle } from "../src/index.ts";

/** Count how many times `needle` occurs in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("deduplicates percent-encoding variants of the same fragment into one lifted component", async () => {
  const entry = "/api/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths:",
      "  /a:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema:",
      "                $ref: './shared.yaml#/components/schemas/Foo'",
      "  /b:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema:",
      // %46 is "F": a URI-equivalent spelling of the same target fragment.
      "                $ref: './shared.yaml#/components/schemas/%46oo'",
    ].join("\n"),
    "/api/shared.yaml": [
      "components:",
      "  schemas:",
      "    Foo:",
      "      type: object",
      "      properties:",
      "        id: { type: string }",
    ].join("\n"),
  }), entry);

  const result = bundle(graph);

  // A single canonical identity, so exactly one component is lifted (no `Foo_2`).
  expect(result.output).not.toContain("Foo_2");
  expect(count(result.output, "\n    Foo:")).toBe(1);
  // Both call sites rewrite to the same lifted component.
  expect(count(result.output, '$ref: "#/components/schemas/Foo"')).toBe(2);
});

test("deduplicates an anchor reference and a JSON Pointer reference to the same node", async () => {
  const entry = "/api/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths:",
      "  /a:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema:",
      "                $ref: './shared.yaml#FooAnchor'",
      "  /b:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema:",
      "                $ref: './shared.yaml#/$defs/Foo'",
    ].join("\n"),
    "/api/shared.yaml": [
      "$defs:",
      "  Foo:",
      "    $anchor: FooAnchor",
      "    type: object",
    ].join("\n"),
  }), entry);

  const result = bundle(graph);

  // One node, one lifted component even though it is reached both ways.
  const lifted = result.output.match(/\$ref: "#\/components\/schemas\/([A-Za-z0-9_]+)"/g) ?? [];
  expect(lifted).toHaveLength(2);
  expect(new Set(lifted).size).toBe(1);
});

test("keeps same-pointer targets in distinct files as separate components", async () => {
  // Two different resources (files) with an identically-named target at the same within-resource
  // pointer must not collapse: canonical identity includes the resource, not just the pointer.
  const entry = "/api/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths:",
      "  /a:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema:",
      "                $ref: './a.yaml#/components/schemas/Foo'",
      "  /b:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema:",
      "                $ref: './b.yaml#/components/schemas/Foo'",
    ].join("\n"),
    "/api/a.yaml": [
      "components:",
      "  schemas:",
      "    Foo: { type: string }",
    ].join("\n"),
    "/api/b.yaml": [
      "components:",
      "  schemas:",
      "    Foo: { type: integer }",
    ].join("\n"),
  }), entry);

  const result = bundle(graph);
  // Distinct targets: two components (Foo and Foo_2), each preserving its own shape.
  expect(result.output).toContain("Foo_2");
  expect(result.output).toContain("type: string");
  expect(result.output).toContain("type: integer");
});

test("uses canonical identity in --dereference cycle detection for percent-encoding variants", async () => {
  // A self-cycle reached via two percent-encoding spellings must be recognised as ONE cycle target,
  // so a single `components/*` slot is kept (and one ref-cycle diagnostic emitted per target).
  const entry = "/api/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths:",
      "  /a:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema:",
      "                $ref: './shared.yaml#/components/schemas/Node'",
      "  /b:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema:",
      "                $ref: './shared.yaml#/components/schemas/%4Eode'",
    ].join("\n"),
    "/api/shared.yaml": [
      "components:",
      "  schemas:",
      "    Node:",
      "      type: object",
      "      properties:",
      // Self-reference forms a cycle that cannot be fully inlined.
      "        next: { $ref: '#/components/schemas/Node' }",
    ].join("\n"),
  }), entry);

  const result = bundle(graph, { dereference: true });

  // The two spellings are the same cycle target -> a single kept component slot, one diagnostic.
  const cycleDiagnostics = result.diagnostics.filter((d) => d.code === "ref-cycle");
  expect(cycleDiagnostics).toHaveLength(1);
  expect(result.output).not.toContain("Node_2");
});
