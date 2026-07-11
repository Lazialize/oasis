import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { childAt } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

const VALID_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object", "null"]);

/**
 * Recursively visits schema-shaped nodes reachable from `node` via properties/items/allOf/oneOf/
 * anyOf/additionalProperties, guarding against revisits (shared refs are not followed here; only
 * the literal nesting within a single schema tree).
 */
function walkSchemas(node: Node, visit: (schema: Node) => void, seen: Set<Node> = new Set()): void {
  if (!isMap(node) || seen.has(node)) return;
  seen.add(node);
  visit(node);

  const properties = childAt(node, "properties");
  if (isMap(properties)) {
    for (const pair of properties.items) {
      if (isNode(pair.value)) walkSchemas(pair.value, visit, seen);
    }
  }

  const items = childAt(node, "items");
  if (isNode(items)) walkSchemas(items, visit, seen);

  const additionalProperties = childAt(node, "additionalProperties");
  if (isNode(additionalProperties)) walkSchemas(additionalProperties, visit, seen);

  for (const key of ["allOf", "oneOf", "anyOf"]) {
    const seq = childAt(node, key);
    if (isSeq(seq)) {
      for (const item of seq.items) {
        if (isNode(item)) walkSchemas(item, visit, seen);
      }
    }
  }
}

function checkSchema(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  if (!isMap(schema)) return;
  const typeNode = childAt(schema, "type");
  const nullableNode = childAt(schema, "nullable");

  if (ctx.version === "3.0") {
    if (typeNode && isSeq(typeNode)) {
      ctx.report({ doc, node: typeNode }, '"type" must be a single string in OpenAPI 3.0 (arrays are a 3.1 feature); use "nullable: true" for nullability.');
    } else if (typeNode && isScalar(typeNode) && typeNode.value === "null") {
      ctx.report({ doc, node: typeNode }, '"type: null" is not valid in OpenAPI 3.0; use "nullable: true" alongside another type instead.');
    }
  } else if (ctx.version === "3.1") {
    if (nullableNode) {
      ctx.report({ doc, node: nullableNode }, '"nullable" is not part of OpenAPI 3.1 (JSON Schema 2020-12); express nullability with a "type" array including "null" instead.');
    }
  }

  if (typeNode && isScalar(typeNode) && typeof typeNode.value === "string" && !VALID_TYPES.has(typeNode.value)) {
    ctx.report({ doc, node: typeNode }, `"type: ${typeNode.value}" is not a recognized JSON Schema type.`);
  } else if (typeNode && isSeq(typeNode)) {
    for (const item of typeNode.items) {
      if (isScalar(item) && typeof item.value === "string" && !VALID_TYPES.has(item.value)) {
        ctx.report({ doc, node: isNode(item) ? item : typeNode }, `"type: ${item.value}" is not a recognized JSON Schema type.`);
      }
    }
  }
}

export const structureSchemaNullable: Rule = {
  name: "structure/schema-nullable",
  description: 'Checks version-appropriate nullability and "type" usage in components/schemas (3.0 "nullable" vs 3.1 type arrays).',
  defaultSeverity: "error",
  check(ctx) {
    if (ctx.version !== "3.0" && ctx.version !== "3.1") return;

    for (const doc of ctx.documents) {
      const root = doc.yamlDoc.contents;
      if (!root || !isMap(root)) continue;
      const components = childAt(root, "components");
      if (!isMap(components)) continue;
      const schemas = childAt(components, "schemas");
      if (!isMap(schemas)) continue;

      for (const pair of schemas.items) {
        if (!isNode(pair.value)) continue;
        walkSchemas(pair.value, (schema) => checkSchema(ctx, doc, schema));
      }
    }
  },
};
