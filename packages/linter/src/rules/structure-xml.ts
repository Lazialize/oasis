import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { iterateSchemas } from "../openapi-walk.ts";
import { childAt, keyToString } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

const ALLOWED_KEYS = new Set(["name", "namespace", "prefix", "attribute", "wrapped"]);
/** A pragmatic "clearly not an absolute URI" check: requires a `scheme:` prefix. */
const ABSOLUTE_URI = /^[a-zA-Z][a-zA-Z\d+\-.]*:\S*$/;

/**
 * Recursively visits schema-shaped nodes reachable from `node` via properties/items/allOf/oneOf/
 * anyOf/additionalProperties (mirrors `structure/schema-nullable`'s walk).
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

function checkXml(ctx: RuleContext, doc: OasisDocument, xmlNode: Node): void {
  if (!isMap(xmlNode)) {
    ctx.report({ doc, node: xmlNode }, '"xml" must be an object.');
    return;
  }

  for (const pair of xmlNode.items) {
    const key = keyToString(pair.key);
    if (key.startsWith("x-")) continue;
    if (!ALLOWED_KEYS.has(key) && isNode(pair.key)) {
      ctx.report(
        { doc, node: pair.key },
        `"xml" has unknown key "${key}"; expected one of: name, namespace, prefix, attribute, wrapped.`,
      );
    }
  }

  for (const field of ["name", "namespace", "prefix"] as const) {
    const fieldNode = childAt(xmlNode, field);
    if (fieldNode && (!isScalar(fieldNode) || typeof fieldNode.value !== "string")) {
      ctx.report({ doc, node: fieldNode }, `"xml.${field}" must be a string.`);
    }
  }

  const namespaceNode = childAt(xmlNode, "namespace");
  if (
    namespaceNode &&
    isScalar(namespaceNode) &&
    typeof namespaceNode.value === "string" &&
    !ABSOLUTE_URI.test(namespaceNode.value)
  ) {
    ctx.report({ doc, node: namespaceNode }, '"xml.namespace" should be an absolute URI (e.g. "https://example.com/ns").');
  }

  for (const field of ["attribute", "wrapped"] as const) {
    const fieldNode = childAt(xmlNode, field);
    if (fieldNode && (!isScalar(fieldNode) || typeof fieldNode.value !== "boolean")) {
      ctx.report({ doc, node: fieldNode }, `"xml.${field}" must be a boolean.`);
    }
  }
}

export const structureXml: Rule = {
  name: "structure/xml",
  description:
    'Checks the Schema Object "xml" field in every schema, including inline ones: allowed keys (name/namespace/prefix/attribute/wrapped), correct primitive types, and that "namespace" looks like an absolute URI.',
  defaultSeverity: "error",
  check(ctx) {
    const seen = new Set<Node>();
    for (const site of iterateSchemas(ctx.graph, ctx.entryDoc, ctx.documents, ctx.version)) {
      walkSchemas(
        site.node,
        (schema) => {
          const xmlNode = childAt(schema, "xml");
          if (xmlNode) checkXml(ctx, site.doc, xmlNode);
        },
        seen,
      );
    }
  },
};
