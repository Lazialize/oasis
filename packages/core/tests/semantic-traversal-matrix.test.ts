import { describe, expect, test } from "bun:test";
import { buildAnchorIndex } from "../src/anchor.ts";
import { parseDocument } from "../src/parse.ts";
import { findRefs } from "../src/ref.ts";

/**
 * Matrix test for the shared semantic traversal (issue #154): a genuine `$ref` and a `$anchor` are
 * planted at every supported OpenAPI object edge and JSON Schema applicator position, alongside
 * lookalike traps in literal instance data (`example`/`default`/`enum`/`const`, Any-valued Example
 * `value` and Link `parameters`/`requestBody`) and opaque `x-*` extension payloads. Reference
 * discovery and anchor indexing consume the same transition tables, so both walkers must see
 * exactly the planted set — nothing missing at any edge, nothing leaked from a trap.
 */

const MATRIX_YAML = `openapi: 3.1.0
info: { title: Matrix, version: 1.0.0 }
x-root:
  $ref: '#/trap/x-root'
paths:
  /a:
    get:
      x-op:
        $ref: '#/trap/x-op'
      parameters:
        - name: q
          in: query
          schema: { $anchor: a-op-param, $ref: '#/r/op-param' }
      requestBody:
        content:
          application/json:
            schema: { $anchor: a-op-body, $ref: '#/r/op-body' }
      responses:
        '200':
          description: ok
          headers:
            X-H:
              schema: { $anchor: a-resp-header, $ref: '#/r/resp-header' }
          content:
            application/json:
              schema: { $anchor: a-resp-body, $ref: '#/r/resp-body' }
              encoding:
                part:
                  headers:
                    X-E:
                      schema: { $anchor: a-enc-header, $ref: '#/r/enc-header' }
              examples:
                sample:
                  value:
                    $anchor: trap-example-anchor
                    $ref: '#/trap/example-value'
      callbacks:
        onEvent:
          'https://cb':
            post:
              requestBody:
                content:
                  application/json:
                    schema: { $anchor: a-op-callback, $ref: '#/r/op-callback' }
webhooks:
  newThing:
    post:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $anchor: a-webhook, $ref: '#/r/webhook' }
components:
  schemas:
    Root:
      $anchor: a-comp-schema
      $ref: '#/r/comp-schema'
      properties:
        p: { $anchor: a-properties, $ref: '#/r/properties' }
      patternProperties:
        '^x': { $anchor: a-patternProperties, $ref: '#/r/patternProperties' }
      $defs:
        d: { $anchor: a-defs, $ref: '#/r/defs' }
      dependentSchemas:
        dep: { $anchor: a-dependentSchemas, $ref: '#/r/dependentSchemas' }
      items: { $anchor: a-items, $ref: '#/r/items' }
      additionalProperties: { $anchor: a-additionalProperties, $ref: '#/r/additionalProperties' }
      not: { $anchor: a-not, $ref: '#/r/not' }
      if: { $anchor: a-if, $ref: '#/r/if' }
      then: { $anchor: a-then, $ref: '#/r/then' }
      else: { $anchor: a-else, $ref: '#/r/else' }
      propertyNames: { $anchor: a-propertyNames, $ref: '#/r/propertyNames' }
      contains: { $anchor: a-contains, $ref: '#/r/contains' }
      unevaluatedItems: { $anchor: a-unevaluatedItems, $ref: '#/r/unevaluatedItems' }
      unevaluatedProperties: { $anchor: a-unevaluatedProperties, $ref: '#/r/unevaluatedProperties' }
      contentSchema: { $anchor: a-contentSchema, $ref: '#/r/contentSchema' }
      allOf:
        - { $anchor: a-allOf, $ref: '#/r/allOf' }
      oneOf:
        - { $anchor: a-oneOf, $ref: '#/r/oneOf' }
      anyOf:
        - { $anchor: a-anyOf, $ref: '#/r/anyOf' }
      prefixItems:
        - { $anchor: a-prefixItems, $ref: '#/r/prefixItems' }
      discriminator:
        propertyName: kind
        mapping:
          dog: '#/r/mapping'
          plain: PlainName
      example:
        $anchor: trap-schema-example
        $ref: '#/trap/schema-example'
      default:
        $ref: '#/trap/schema-default'
      enum:
        - $ref: '#/trap/schema-enum'
      const:
        $ref: '#/trap/schema-const'
    WithDynamic:
      $dynamicAnchor: a-dynamic
      $dynamicRef: '#a-dynamic'
    NamedLikeLiteral:
      properties:
        example: { $anchor: a-prop-named-example, $ref: '#/r/prop-named-example' }
  parameters:
    P:
      name: p
      in: query
      schema: { $anchor: a-comp-param, $ref: '#/r/comp-param' }
  headers:
    H:
      schema: { $anchor: a-comp-header, $ref: '#/r/comp-header' }
  requestBodies:
    RB:
      content:
        application/json:
          schema: { $anchor: a-comp-rb, $ref: '#/r/comp-rb' }
  responses:
    R:
      description: ok
      headers:
        X-R:
          schema: { $anchor: a-comp-resp-header, $ref: '#/r/comp-resp-header' }
      content:
        application/json:
          schema: { $anchor: a-comp-resp-body, $ref: '#/r/comp-resp-body' }
  pathItems:
    PI:
      get:
        responses:
          '200':
            description: ok
            content:
              application/json:
                schema: { $anchor: a-comp-pathitem, $ref: '#/r/comp-pathitem' }
  callbacks:
    CB:
      'https://cb2':
        get:
          parameters:
            - name: c
              in: query
              schema: { $anchor: a-comp-callback, $ref: '#/r/comp-callback' }
  examples:
    Ex:
      value:
        $anchor: trap-component-example-anchor
        $ref: '#/trap/component-example-value'
  links:
    L:
      operationId: getA
      parameters:
        q: { $ref: '#/trap/link-parameters' }
      requestBody: { $ref: '#/trap/link-requestBody' }
`;

/** Every genuine reference planted above (one per supported transition). */
const EXPECTED_REFS = [
  "#/r/op-param",
  "#/r/op-body",
  "#/r/resp-header",
  "#/r/resp-body",
  "#/r/enc-header",
  "#/r/op-callback",
  "#/r/webhook",
  "#/r/comp-schema",
  "#/r/properties",
  "#/r/patternProperties",
  "#/r/defs",
  "#/r/dependentSchemas",
  "#/r/items",
  "#/r/additionalProperties",
  "#/r/not",
  "#/r/if",
  "#/r/then",
  "#/r/else",
  "#/r/propertyNames",
  "#/r/contains",
  "#/r/unevaluatedItems",
  "#/r/unevaluatedProperties",
  "#/r/contentSchema",
  "#/r/allOf",
  "#/r/oneOf",
  "#/r/anyOf",
  "#/r/prefixItems",
  "#/r/mapping",
  "#a-dynamic",
  "#/r/prop-named-example",
  "#/r/comp-param",
  "#/r/comp-header",
  "#/r/comp-rb",
  "#/r/comp-resp-header",
  "#/r/comp-resp-body",
  "#/r/comp-pathitem",
  "#/r/comp-callback",
].sort();

/** Every genuine anchor planted above (only real 3.1 Schema Object positions define anchors). */
const EXPECTED_ANCHORS = [
  "a-op-param",
  "a-op-body",
  "a-resp-header",
  "a-resp-body",
  "a-enc-header",
  "a-op-callback",
  "a-webhook",
  "a-comp-schema",
  "a-properties",
  "a-patternProperties",
  "a-defs",
  "a-dependentSchemas",
  "a-items",
  "a-additionalProperties",
  "a-not",
  "a-if",
  "a-then",
  "a-else",
  "a-propertyNames",
  "a-contains",
  "a-unevaluatedItems",
  "a-unevaluatedProperties",
  "a-contentSchema",
  "a-allOf",
  "a-oneOf",
  "a-anyOf",
  "a-prefixItems",
  "a-dynamic",
  "a-prop-named-example",
  "a-comp-param",
  "a-comp-header",
  "a-comp-rb",
  "a-comp-resp-header",
  "a-comp-resp-body",
  "a-comp-pathitem",
  "a-comp-callback",
].sort();

describe("shared semantic traversal matrix (issue #154)", () => {
  const doc = parseDocument(MATRIX_YAML, "/virtual/matrix/openapi.yaml");

  test("findRefs discovers a reference at every supported transition and nothing from traps", () => {
    const values = findRefs(doc).map((ref) => ref.value).sort();
    expect(values).toEqual(EXPECTED_REFS);
    // Traps stayed opaque: no literal-data, Any-valued, or extension payload leaked through.
    expect(values.some((value) => value.includes("/trap/"))).toBe(false);
    expect(values).not.toContain("PlainName");
  });

  test("buildAnchorIndex indexes an anchor at every supported transition and nothing from traps", () => {
    const index = buildAnchorIndex(doc);
    const names = [...index.byName.keys()].sort();
    expect(names).toEqual(EXPECTED_ANCHORS);
    expect(index.byName.get("a-dynamic")!.dynamic).toBe(true);
    expect(index.byName.get("a-comp-schema")!.dynamic).toBe(false);
  });

  test("every reference position also indexes anchors, and vice versa (walkers agree)", () => {
    // Both walkers consume the same transition tables, so the sets must correspond 1:1 for the
    // schema positions (the mapping/dynamic refs are ref-only syntax; everything else pairs up).
    const refPositions = findRefs(doc)
      .map((ref) => ref.value)
      .filter((value) => value.startsWith("#/r/"))
      .map((value) => value.slice("#/r/".length))
      .sort();
    const anchorPositions = [...buildAnchorIndex(doc).byName.keys()]
      .filter((name) => name.startsWith("a-") && name !== "a-dynamic")
      .map((name) => name.slice("a-".length))
      .sort();
    expect(refPositions.filter((p) => p !== "mapping")).toEqual(anchorPositions);
  });

  test("results are cached: repeated calls do not re-walk the tree", () => {
    // Identity equality proves the memoized result is returned, guarding against a regression
    // where each consumer (graph load plus several lint rules) re-walks the full tree.
    expect(findRefs(doc)).toBe(findRefs(doc));
    expect(buildAnchorIndex(doc)).toBe(buildAnchorIndex(doc));
  });
});

describe("aliases and occurrence-specific $id bases (issue #154)", () => {
  const ALIAS_YAML = `openapi: 3.1.0
info: { title: Alias, version: 1.0.0 }
components:
  schemas:
    Shared: &shared
      $anchor: shared-anchor
      $ref: '#/r/shared'
    A:
      $id: 'https://example.com/a'
      properties:
        s: *shared
    B:
      $id: 'https://example.com/b'
      properties:
        s: *shared
`;
  const doc = parseDocument(ALIAS_YAML, "/virtual/alias/openapi.yaml");

  test("findRefs records one occurrence of an aliased ref per resource base", () => {
    const shared = findRefs(doc).filter((ref) => ref.value === "#/r/shared");
    const bases = shared.map((ref) => ref.baseUri).sort();
    expect(bases).toEqual([
      "file:///virtual/alias/openapi.yaml",
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  test("anchor index tracks every base an aliased schema node is reached under", () => {
    const index = buildAnchorIndex(doc);
    const entry = index.byName.get("shared-anchor")!;
    expect(entry).toBeDefined();
    const bases = [...(index.baseUrisByNode.get(entry.node) ?? [])].sort();
    expect(bases).toEqual([
      "file:///virtual/alias/openapi.yaml",
      "https://example.com/a",
      "https://example.com/b",
    ]);
    // The anchor is addressable within each $id resource that contains an occurrence of the node.
    expect(index.byResource.get("https://example.com/a")?.has("shared-anchor")).toBe(true);
    expect(index.byResource.get("https://example.com/b")?.has("shared-anchor")).toBe(true);
  });
});
