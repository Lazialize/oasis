import { isMap, isNode, isScalar } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { iterateSchemas, walkSchemaTree } from "../openapi-walk.ts";
import { childAt, keyToString } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

const ALLOWED_KEYS = new Set(["name", "namespace", "prefix", "attribute", "wrapped"]);
/** A pragmatic "clearly not an absolute URI" check: requires a `scheme:` prefix. */
const ABSOLUTE_URI = /^[a-zA-Z][a-zA-Z\d+\-.]*:\S*$/;

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
      walkSchemaTree(
        site.node,
        (schema) => {
          const xmlNode = childAt(schema, "xml");
          if (xmlNode) checkXml(ctx, site.doc, xmlNode);
        },
        ctx.version,
        seen,
      );
    }
  },
};
