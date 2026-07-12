import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { resolveRef } from "@oasis/core";
import type { OasisDocument } from "@oasis/core";
import { iterateSchemas } from "../openapi-walk.ts";
import { childAt, isRefObject, keyToString, resolveMaybeRef } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

/** Mapping/URL-ish values (absolute URIs) are external targets; skip resolution for those. */
function isUrlLike(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) || value.startsWith("//");
}

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

    const refString = value.includes("#") ? value : `#/components/schemas/${value}`;
    const result = resolveRef(ctx.graph, doc, refString);
    if (!result.ok) {
      ctx.report(
        { doc, node: pair.value },
        `${label} "discriminator.mapping" entry "${key}" -> "${value}" does not resolve to a schema in the workspace.`,
      );
    }
  }
}

/**
 * Recursively visits schema-shaped nodes reachable from `node` via properties/items/allOf/oneOf/
 * anyOf/additionalProperties (+ 3.1 `prefixItems`), mirroring the walk in `structure/schema-
 * nullable`; `$ref`s are not followed for discovery (a $ref'd schema's own discriminator is found
 * when its `components/schemas` entry is visited directly).
 */
function walkSchemas(ctx: RuleContext, doc: OasisDocument, node: Node, seen: Set<Node>): void {
  if (!isMap(node) || seen.has(node)) return;
  seen.add(node);

  checkDiscriminator(ctx, doc, node, "Schema");

  const properties = childAt(node, "properties");
  if (isMap(properties)) {
    for (const pair of properties.items) {
      if (isNode(pair.value)) walkSchemas(ctx, doc, pair.value, seen);
    }
  }

  const items = childAt(node, "items");
  if (isNode(items)) walkSchemas(ctx, doc, items, seen);

  if (ctx.version === "3.1") {
    const prefixItems = childAt(node, "prefixItems");
    if (isSeq(prefixItems)) {
      for (const item of prefixItems.items) {
        if (isNode(item)) walkSchemas(ctx, doc, item, seen);
      }
    }
  }

  const additionalProperties = childAt(node, "additionalProperties");
  if (isNode(additionalProperties)) walkSchemas(ctx, doc, additionalProperties, seen);

  for (const key of ["allOf", "oneOf", "anyOf"]) {
    const seq = childAt(node, key);
    if (isSeq(seq)) {
      for (const item of seq.items) {
        if (isNode(item)) walkSchemas(ctx, doc, item, seen);
      }
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
      walkSchemas(ctx, site.doc, site.node, seen);
    }
  },
};
