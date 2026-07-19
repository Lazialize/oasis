import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { resolveAlias, resolveRef } from "@oasis/core";
import type { OasisDocument } from "@oasis/core";
import { iterateSchemas, walkSchemaTree } from "../openapi-walk.ts";
import { childAt, classifyMappingValue, isRefObject, keyToString, resolveMaybeRef } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

function scalarStrings(node: Node | undefined): string[] {
  if (!isSeq(node)) return [];
  return node.items
    .filter((item): item is Node => isNode(item) && isScalar(item) && typeof item.value === "string")
    .map((item) => (isScalar(item) ? (item.value as string) : ""));
}

/** The `properties` and `required` a Schema effectively contributes, once `allOf` is flattened. */
interface EffectiveSchema {
  properties: Set<string>;
  required: Set<string>;
  /**
   * False when any composed member was an unresolvable/external `$ref`: the effective property set
   * is then incomplete-but-unknowable, so absences must not be reported (unknown ≠ missing).
   */
  complete: boolean;
}

/**
 * Accumulate a Schema's effective `properties` and `required` into `acc`, following `$ref`s and
 * flattening `allOf` members (the only composition keyword whose members are all guaranteed to
 * apply). `oneOf`/`anyOf` are *not* descended: an alternative can't guarantee a property. Cycles
 * (`allOf` chains that loop back through `$ref`s) are broken via `visited`, keyed by resolved node
 * identity, so an unbounded chain terminates.
 */
function collectEffectiveSchema(
  ctx: RuleContext,
  doc: OasisDocument,
  node: Node,
  visited: Set<Node>,
  acc: EffectiveSchema,
): void {
  let curDoc = doc;
  let curNode: Node = node;
  if (isMap(node) && isRefObject(node)) {
    const resolved = resolveMaybeRef(ctx.graph, doc, node, "");
    if (isRefObject(resolved.node)) {
      // Unresolved / external $ref: its contribution is unknowable, not empty.
      acc.complete = false;
      return;
    }
    curDoc = resolved.doc;
    curNode = resolved.node;
  }
  if (!isMap(curNode) || visited.has(curNode)) return;
  visited.add(curNode);

  const properties = childAt(curNode, "properties");
  if (isMap(properties)) {
    for (const p of properties.items) {
      const name = keyToString(p.key);
      if (name) acc.properties.add(name);
    }
  }
  for (const name of scalarStrings(childAt(curNode, "required"))) acc.required.add(name);

  const allOf = childAt(curNode, "allOf");
  if (isSeq(allOf)) {
    for (const item of allOf.items) {
      if (isNode(item)) collectEffectiveSchema(ctx, curDoc, item, visited, acc);
    }
  }
}

/** Whether `propertyName` is present in a Schema's effective properties (and, in 3.0, `required`). */
function effectiveSchemaHas(
  ctx: RuleContext,
  doc: OasisDocument,
  node: Node,
  propertyName: string,
): { hasProperty: boolean; hasRequired: boolean; complete: boolean } {
  const acc: EffectiveSchema = { properties: new Set(), required: new Set(), complete: true };
  collectEffectiveSchema(ctx, doc, node, new Set(), acc);
  return {
    hasProperty: acc.properties.has(propertyName),
    hasRequired: acc.required.has(propertyName),
    complete: acc.complete,
  };
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

  const { hasProperty, hasRequired, complete } = effectiveSchemaHas(ctx, branchDoc, branchNode, propertyName);
  // An incomplete effective schema (some composed member is an unresolvable/external $ref) means
  // an absent property or `required` entry is unknowable, not missing — suppress those reports.
  if (!complete && (!hasProperty || !hasRequired)) return;

  if (!hasProperty) {
    ctx.report(
      { doc: branchDoc, node: branchNode },
      `${label} discriminator property "${propertyName}" is not defined in the effective "${compositionKey}[${index}]" schema (including any "allOf"/"$ref" it composes).`,
    );
  }

  if (ctx.version === "3.0" && !hasRequired) {
    ctx.report(
      { doc: branchDoc, node: branchNode },
      `${label} discriminator property "${propertyName}" must be listed in "required" of the effective "${compositionKey}[${index}]" schema (OpenAPI 3.0 requires discriminator properties to be required).`,
    );
  }
}

function checkMapping(ctx: RuleContext, doc: OasisDocument, mappingNode: Node, label: string): void {
  if (!isMap(mappingNode)) {
    ctx.report({ doc, node: mappingNode }, `${label} "discriminator.mapping" must be an object.`);
    return;
  }

  for (const pair of mappingNode.items) {
    const key = keyToString(pair.key);
    const value = isNode(pair.value) ? resolveAlias(pair.value, doc.yamlDoc) ?? pair.value : undefined;
    if (!isScalar(value) || typeof value.value !== "string") {
      ctx.report(
        { doc, node: isNode(pair.value) ? pair.value : mappingNode },
        `${label} "discriminator.mapping" entry "${key}" must have a string value.`,
      );
      continue;
    }

    const target = classifyMappingValue(value.value);
    if (target.kind === "external") continue; // absolute non-filesystem URI, not a workspace target

    const result = resolveRef(ctx.graph, doc, target.ref);
    if (!result.ok) {
      ctx.report(
        { doc, node: value },
        `${label} "discriminator.mapping" entry "${key}" -> "${value.value}" does not resolve to a schema in the workspace.`,
      );
    }
  }
}

function checkDefaultMapping(ctx: RuleContext, doc: OasisDocument, node: Node, label: string): void {
  if (ctx.version !== "3.2") {
    ctx.report({ doc, node }, `${label} "discriminator.defaultMapping" is only valid in OpenAPI 3.2.`);
    return;
  }
  if (!isScalar(node) || typeof node.value !== "string" || node.value === "") {
    ctx.report({ doc, node }, `${label} "discriminator.defaultMapping" must be a non-empty string.`);
    return;
  }
  const target = classifyMappingValue(node.value);
  if (target.kind === "external") return;
  const result = resolveRef(ctx.graph, doc, target.ref);
  if (!result.ok) {
    ctx.report({ doc, node }, `${label} "discriminator.defaultMapping" -> "${node.value}" does not resolve to a schema in the workspace.`);
  }
}

function checkDiscriminator(ctx: RuleContext, doc: OasisDocument, schemaNode: Node, label: string): void {
  if (!isMap(schemaNode)) return;
  const discNode = childAt(schemaNode, "discriminator");
  if (!discNode) return;

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
  const defaultMappingNode = childAt(discNode, "defaultMapping");
  if (defaultMappingNode) checkDefaultMapping(ctx, doc, defaultMappingNode, label);

  if (ctx.version === "3.2") {
    const ownShape = effectiveSchemaHas(ctx, doc, schemaNode, propertyName);
    if (ownShape.complete && ownShape.hasProperty && !ownShape.hasRequired && !defaultMappingNode) {
      ctx.report(
        { doc, node: discNode },
        `${label} has an optional discriminator property "${propertyName}" and must define "defaultMapping" in OpenAPI 3.2.`,
      );
    }
  }

  const oneOf = childAt(schemaNode, "oneOf");
  const anyOf = childAt(schemaNode, "anyOf");
  const allOf = childAt(schemaNode, "allOf");
  const hasComposition = isSeq(oneOf) || isSeq(anyOf) || isSeq(allOf);
  if (!hasComposition) {
    // Parent-discriminator pattern: no composition keyword here, but valid when this Schema itself
    // defines the discriminator property (children reference it via their own `allOf`). Report only
    // when the property (or, in 3.0, its `required` entry) is genuinely absent from this Schema.
    const { hasProperty, hasRequired, complete } = effectiveSchemaHas(ctx, doc, schemaNode, propertyName);
    // Same as branch checks: an incomplete effective schema makes absences unknowable, not missing.
    if (!complete && (!hasProperty || !hasRequired)) return;
    if (!hasProperty) {
      ctx.report(
        { doc, node: discNode },
        `${label} discriminator property "${propertyName}" is not defined by this schema; a discriminator without "oneOf"/"anyOf" must define "${propertyName}" so child schemas can inherit it via "allOf".`,
      );
    } else if (ctx.version === "3.0" && !hasRequired) {
      ctx.report(
        { doc, node: discNode },
        `${label} discriminator property "${propertyName}" must be listed in this schema's "required" (OpenAPI 3.0 requires discriminator properties to be required).`,
      );
    }
    return;
  }

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
    'Checks Discriminator Objects on schemas: required "propertyName" (string), "mapping" values resolve to an in-workspace schema (external/URL-ish targets are skipped), and (per spec) "propertyName" must be a defined property of each resolvable "oneOf"/"anyOf" branch schema — derived through composed "allOf"/"$ref" chains — and, in OpenAPI 3.0, listed in that branch\'s effective "required". A discriminator without "oneOf"/"anyOf" is accepted as the parent-discriminator pattern when the schema itself defines "propertyName".',
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
