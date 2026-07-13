import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { resolveRef } from "@oasis/core";
import type { OasisDocument } from "@oasis/core";
import { iterateSchemas, walkSchemaTree } from "../openapi-walk.ts";
import { childAt, isRefObject, isUrlLike, keyToString, resolveMaybeRef, toSchemaRefString } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

function scalarStrings(node: Node | undefined): string[] {
  if (!isSeq(node)) return [];
  return node.items
    .filter((item): item is Node => isNode(item) && isScalar(item) && typeof item.value === "string")
    .map((item) => (isScalar(item) ? (item.value as string) : ""));
}

/** Checks a single branch schema (a `oneOf`/`anyOf` member) for the discriminator's `propertyName`. */
function checkBranch(
  ctx: RuleContext,
  doc: OasisDocument,
  item: Node,
  compositionKey: string,
  index: number,
  propertyName: string,
  label: string,
): void {
  let branchDoc = doc;
  let branchNode = item;

  if (isMap(item) && isRefObject(item)) {
    const resolved = resolveMaybeRef(ctx.graph, doc, item, "");
    if (isRefObject(resolved.node)) return; // unresolved / external $ref: skip
    branchDoc = resolved.doc;
    branchNode = resolved.node;
  }
  if (!isMap(branchNode)) return;

  const properties = childAt(branchNode, "properties");
  const hasProperty = isMap(properties) && properties.items.some((p) => keyToString(p.key) === propertyName);
  if (!hasProperty) {
    ctx.report(
      { doc: branchDoc, node: branchNode },
      `${label} discriminator property "${propertyName}" is not defined in "${compositionKey}[${index}]" schema properties.`,
    );
  }

  if (ctx.version === "3.0") {
    const requiredNames = scalarStrings(childAt(branchNode, "required"));
    if (!requiredNames.includes(propertyName)) {
      ctx.report(
        { doc: branchDoc, node: branchNode },
        `${label} discriminator property "${propertyName}" must be listed in "required" of "${compositionKey}[${index}]" schema (OpenAPI 3.0 requires discriminator properties to be required).`,
      );
    }
  }
}

function checkMapping(ctx: RuleContext, doc: OasisDocument, mappingNode: Node, label: string): void {
  if (!isMap(mappingNode)) {
    ctx.report({ doc, node: mappingNode }, `${label} "discriminator.mapping" must be an object.`);
    return;
  }

  for (const pair of mappingNode.items) {
    const key = keyToString(pair.key);
    if (!isNode(pair.value) || !isScalar(pair.value) || typeof pair.value.value !== "string") {
      ctx.report(
        { doc, node: isNode(pair.value) ? pair.value : mappingNode },
        `${label} "discriminator.mapping" entry "${key}" must have a string value.`,
      );
      continue;
    }

    const value = pair.value.value;
    if (isUrlLike(value)) continue; // external target, skip

    const result = resolveRef(ctx.graph, doc, toSchemaRefString(value));
    if (!result.ok) {
      ctx.report(
        { doc, node: pair.value },
        `${label} "discriminator.mapping" entry "${key}" -> "${value}" does not resolve to a schema in the workspace.`,
      );
    }
  }
}

function checkDiscriminator(ctx: RuleContext, doc: OasisDocument, schemaNode: Node, label: string): void {
  if (!isMap(schemaNode)) return;
  const discNode = childAt(schemaNode, "discriminator");
  if (!discNode) return;

  const oneOf = childAt(schemaNode, "oneOf");
  const anyOf = childAt(schemaNode, "anyOf");
  const allOf = childAt(schemaNode, "allOf");
  const hasComposition = isSeq(oneOf) || isSeq(anyOf) || isSeq(allOf);
  if (!hasComposition) {
    ctx.report(
      { doc, node: discNode },
      `${label} declares "discriminator" but has none of "oneOf", "anyOf", or "allOf"; discriminator usage is limited to schema composition.`,
    );
  }

  if (!isMap(discNode)) {
    ctx.report({ doc, node: discNode }, `${label} "discriminator" must be an object.`);
    return;
  }

  const propNode = childAt(discNode, "propertyName");
  if (!propNode || !isScalar(propNode) || typeof propNode.value !== "string" || propNode.value === "") {
    ctx.report({ doc, node: discNode }, `${label} "discriminator" is missing required field "propertyName" (string).`);
    return;
  }
  const propertyName = propNode.value;

  const mappingNode = childAt(discNode, "mapping");
  if (mappingNode) checkMapping(ctx, doc, mappingNode, label);

  for (const [seqNode, compositionKey] of [
    [oneOf, "oneOf"],
    [anyOf, "anyOf"],
  ] as const) {
    if (!isSeq(seqNode)) continue;
    seqNode.items.forEach((item, i) => {
      if (isNode(item)) checkBranch(ctx, doc, item, compositionKey, i, propertyName, label);
    });
  }
}

export const structureDiscriminator: Rule = {
  name: "structure/discriminator",
  description:
    'Checks Discriminator Objects on schemas: required "propertyName" (string), "mapping" values resolve to an in-workspace schema (external/URL-ish targets are skipped), a discriminator requires "oneOf"/"anyOf"/"allOf" on the same schema, and (per spec) "propertyName" must be a defined property of each resolvable "oneOf"/"anyOf" branch schema — and, in OpenAPI 3.0, listed in that branch\'s "required".',
  defaultSeverity: "error",
  check(ctx) {
    const seen = new Set<Node>();
    for (const site of iterateSchemas(ctx.graph, ctx.entryDoc, ctx.documents, ctx.version)) {
      walkSchemaTree(
        site.node,
        (schema) => checkDiscriminator(ctx, site.doc, schema, "Schema"),
        ctx.version,
        seen,
      );
    }
  },
};
