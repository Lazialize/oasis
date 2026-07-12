import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { iterateOperations, iterateSchemas } from "../openapi-walk.ts";
import { childAt, keyToString, resolveMaybeRef } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";
import { validateExample } from "./validate-example.ts";
import type { ValidateEnv } from "./validate-example.ts";

/**
 * Recursively visits schema-shaped nodes reachable from `node` via properties/items/allOf/oneOf/
 * anyOf/additionalProperties (+ 3.1 `prefixItems`), guarding against revisits. Mirrors the walk
 * in `structure/schema-nullable`; `$ref`s are not followed for discovery purposes (only literal
 * nesting), matching that rule's convention — a `$ref`'d schema's own `example` is found when its
 * `components/schemas` entry is visited directly.
 */
function walkSchemasForSelfExamples(ctx: RuleContext, env: ValidateEnv, doc: OasisDocument, node: Node, seen: Set<Node>): void {
  if (!isMap(node) || seen.has(node)) return;
  seen.add(node);

  const exampleNode = childAt(node, "example");
  if (exampleNode) {
    reportFailures(ctx, env, { doc, node }, doc, exampleNode, "Schema");
  }

  const properties = childAt(node, "properties");
  if (isMap(properties)) {
    for (const pair of properties.items) {
      if (isNode(pair.value)) walkSchemasForSelfExamples(ctx, env, doc, pair.value, seen);
    }
  }

  const items = childAt(node, "items");
  if (isNode(items)) walkSchemasForSelfExamples(ctx, env, doc, items, seen);

  if (env.version === "3.1") {
    const prefixItems = childAt(node, "prefixItems");
    if (isSeq(prefixItems)) {
      for (const item of prefixItems.items) {
        if (isNode(item)) walkSchemasForSelfExamples(ctx, env, doc, item, seen);
      }
    }
  }

  const additionalProperties = childAt(node, "additionalProperties");
  if (isNode(additionalProperties)) walkSchemasForSelfExamples(ctx, env, doc, additionalProperties, seen);

  for (const key of ["allOf", "oneOf", "anyOf"]) {
    const seq = childAt(node, key);
    if (isSeq(seq)) {
      for (const item of seq.items) {
        if (isNode(item)) walkSchemasForSelfExamples(ctx, env, doc, item, seen);
      }
    }
  }
}

function reportFailures(
  ctx: RuleContext,
  env: ValidateEnv,
  schemaLoc: { doc: OasisDocument; node: Node },
  exampleDoc: OasisDocument,
  exampleNode: Node,
  label: string,
): void {
  const failures = validateExample(env, schemaLoc, exampleNode);
  for (const failure of failures) {
    ctx.report({ doc: exampleDoc, node: failure.node }, `${label} example does not match schema: ${failure.message}`);
  }
}

/**
 * Checks a Media Type Object or Parameter Object that carries a `schema` directly (not via
 * `content`): validates its `example`, and each `examples.<name>.value` (`externalValue` entries
 * are skipped — there's no local value to validate), against that schema. Also walks the schema
 * itself for nested `example` keywords.
 */
function checkExampleBearingObject(ctx: RuleContext, env: ValidateEnv, doc: OasisDocument, node: Node, label: string, seen: Set<Node>): void {
  if (seen.has(node)) return;
  seen.add(node);

  const schemaNode = childAt(node, "schema");
  if (!schemaNode) return;
  const schemaLoc = { doc, node: schemaNode };

  const exampleNode = childAt(node, "example");
  if (exampleNode) {
    reportFailures(ctx, env, schemaLoc, doc, exampleNode, label);
  }

  const examplesNode = childAt(node, "examples");
  if (isMap(examplesNode)) {
    for (const pair of examplesNode.items) {
      const name = keyToString(pair.key);
      if (!isNode(pair.value)) continue;
      const resolved = resolveMaybeRef(ctx.graph, doc, pair.value, "");
      if (!isMap(resolved.node)) continue;
      if (childAt(resolved.node, "externalValue")) continue; // can't validate a value we don't have
      const valueNode = childAt(resolved.node, "value");
      if (!valueNode) continue;
      reportFailures(ctx, env, schemaLoc, resolved.doc, valueNode, `${label} examples."${name}"`);
    }
  }

  walkSchemasForSelfExamples(ctx, env, doc, schemaNode, seen);
}

/** Checks every Media Type Object in a `content` map. */
function checkContentNode(ctx: RuleContext, env: ValidateEnv, doc: OasisDocument, contentNode: Node | undefined, label: string, seen: Set<Node>): void {
  if (!isMap(contentNode)) return;
  for (const pair of contentNode.items) {
    const mediaType = keyToString(pair.key);
    if (!isNode(pair.value) || !isMap(pair.value)) continue;
    checkExampleBearingObject(ctx, env, doc, pair.value, `${label} content "${mediaType}"`, seen);
  }
}

/** Checks a Parameter Object, which uses either `content` (per-media-type) or `schema` directly. */
function checkParameterObject(ctx: RuleContext, env: ValidateEnv, doc: OasisDocument, node: Node, label: string, seen: Set<Node>): void {
  if (seen.has(node)) return;
  const contentNode = childAt(node, "content");
  if (isMap(contentNode)) {
    checkContentNode(ctx, env, doc, contentNode, `${label} content`, seen);
  } else {
    checkExampleBearingObject(ctx, env, doc, node, label, seen);
  }
}

function checkParamsArray(ctx: RuleContext, env: ValidateEnv, doc: OasisDocument, arrNode: Node | undefined, label: string, seen: Set<Node>): void {
  if (!isSeq(arrNode)) return;
  arrNode.items.forEach((item, i) => {
    if (!isNode(item)) return;
    const resolved = resolveMaybeRef(ctx.graph, doc, item, "");
    if (!isMap(resolved.node)) return;
    const nameNode = childAt(resolved.node, "name");
    const name = isScalar(nameNode) && typeof nameNode.value === "string" ? nameNode.value : `#${i}`;
    checkParameterObject(ctx, env, resolved.doc, resolved.node, `${label} parameter "${name}"`, seen);
  });
}

export const exampleSchemaMatch: Rule = {
  name: "example-schema-match",
  description:
    'Checks that "example"/"examples[].value" values conform to their schema, version-aware (3.0 dialect vs 3.1 / JSON Schema 2020-12). Validates a hand-rolled subset of keywords (see README); schemas using "not", "discriminator", or an unresolved $ref are skipped.',
  defaultSeverity: "warn",
  check(ctx) {
    if (ctx.version !== "3.0" && ctx.version !== "3.1") return;
    const env: ValidateEnv = { graph: ctx.graph, version: ctx.version };
    const seen = new Set<Node>();

    // Every schema root (components/schemas plus inline request/response/parameter/header
    // schemas, and 3.1 webhooks): validate nested schema-level `example` keywords. The walker
    // dedupes $ref-shared schemas, and the shared `seen` set keeps the media-type/parameter pass
    // below from re-walking the same schema nodes.
    for (const site of iterateSchemas(ctx.graph, ctx.entryDoc, ctx.documents, ctx.version)) {
      walkSchemasForSelfExamples(ctx, env, site.doc, site.node, seen);
    }

    for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
      const label = `Operation "${op.method.toUpperCase()} ${op.pathItem.template}"`;

      const rbNode = childAt(op.node, "requestBody");
      if (rbNode) {
        const resolved = resolveMaybeRef(ctx.graph, op.doc, rbNode, `${op.pointer}/requestBody`);
        if (isMap(resolved.node)) {
          checkContentNode(ctx, env, resolved.doc, childAt(resolved.node, "content"), `${label} request body`, seen);
        }
      }

      const responsesNode = childAt(op.node, "responses");
      if (isMap(responsesNode)) {
        for (const pair of responsesNode.items) {
          const status = keyToString(pair.key);
          if (!isNode(pair.value)) continue;
          const resolved = resolveMaybeRef(ctx.graph, op.doc, pair.value, `${op.pointer}/responses/${status}`);
          if (!isMap(resolved.node)) continue;
          checkContentNode(ctx, env, resolved.doc, childAt(resolved.node, "content"), `${label} response "${status}"`, seen);
        }
      }

      checkParamsArray(ctx, env, op.pathItem.doc, childAt(op.pathItem.node, "parameters"), label, seen);
      checkParamsArray(ctx, env, op.doc, childAt(op.node, "parameters"), label, seen);
    }
  },
};
