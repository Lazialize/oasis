import { isMap, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { iterateSchemas, walkSchemaTree } from "../openapi-walk.ts";
import { childAt } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

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
  } else if (ctx.version === "3.1" || ctx.version === "3.2") {
    if (nullableNode) {
      ctx.report({ doc, node: nullableNode }, '"nullable" is not part of OpenAPI 3.1 (JSON Schema 2020-12); express nullability with a "type" array including "null" instead.');
    }
  }
}

export const structureSchemaNullable: Rule = {
  name: "structure/schema-nullable",
  description: 'Checks version-appropriate nullability in every schema, including inline ones: 3.0 "nullable" vs 3.1 type arrays with "null", and rejects invalid forms like type arrays in 3.0 or "type: null" scalars in 3.0.',
  defaultSeverity: "error",
  check(ctx) {
    if (ctx.version !== "3.0" && ctx.version !== "3.1" && ctx.version !== "3.2") return;

    const seen = new Set<Node>();
    for (const site of iterateSchemas(ctx.graph, ctx.entryDoc, ctx.documents, ctx.version)) {
      walkSchemaTree(site.node, (schema) => checkSchema(ctx, site.doc, schema), ctx.version, seen);
    }
  },
};
