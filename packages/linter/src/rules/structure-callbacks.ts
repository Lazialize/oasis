import { isMap, isNode } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { HTTP_METHODS, PATH_ITEM_NON_METHOD_KEYS, iterateOperations } from "../openapi-walk.ts";
import { childAt, hasAnyResponseEntry, keyToString, resolveMaybeRef, visitResolvedUnique } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

const RUNTIME_EXPRESSION = /\{\$[^{}]*\}/;
const URL_LIKE = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/|\/)/;

/** Validates the Path Item Object a callback expression maps to, reusing structure/http-methods's shape. */
function checkCallbackPathItem(ctx: RuleContext, doc: OasisDocument, node: Node, label: string): void {
  if (!isMap(node)) {
    ctx.report({ doc, node }, `${label} must be a Path Item Object.`);
    return;
  }

  const allowedKeys = new Set<string>([
    ...HTTP_METHODS.filter((method) => method !== "query" || ctx.version === "3.2"),
    ...[...PATH_ITEM_NON_METHOD_KEYS].filter((key) => key !== "additionalOperations" || ctx.version === "3.2"),
  ]);
  for (const pair of node.items) {
    const key = keyToString(pair.key);
    if (!allowedKeys.has(key) && !key.startsWith("x-") && isNode(pair.key)) {
      ctx.report(
        { doc, node: pair.key },
        `${label} has invalid key "${key}" (expected an HTTP method or one of: ${[...PATH_ITEM_NON_METHOD_KEYS].join(", ")}).`,
      );
    }
  }

  for (const method of HTTP_METHODS) {
    if (method === "query" && ctx.version !== "3.2") continue;
    const opNode = childAt(node, method);
    if (!opNode) continue;
    const resolved = resolveMaybeRef(ctx.graph, doc, opNode, "");
    if (!isMap(resolved.node)) {
      ctx.report({ doc: resolved.doc, node: resolved.node }, `${label}.${method} must be an object.`);
      continue;
    }
    // Operation.responses is REQUIRED in 3.0 but optional since 3.1 (see structure/field-types).
    const responsesNode = childAt(resolved.node, "responses");
    if (!responsesNode) {
      if (ctx.version === "3.0") {
        ctx.report({ doc: resolved.doc, node: resolved.node }, `${label}.${method} is missing required field "responses".`);
      }
    } else if (isMap(responsesNode) && !hasAnyResponseEntry(responsesNode)) {
      ctx.report(
        { doc: resolved.doc, node: responsesNode },
        `${label}.${method}.responses must contain at least one response code, "default", or an extension ("x-*") field.`,
      );
    }
  }
  if (ctx.version === "3.2") {
    const additional = childAt(node, "additionalOperations");
    if (isMap(additional)) {
      for (const pair of additional.items) {
        const method = keyToString(pair.key);
        if (!isNode(pair.value)) continue;
        const resolved = resolveMaybeRef(ctx.graph, doc, pair.value, "");
        if (!isMap(resolved.node)) {
          ctx.report({ doc: resolved.doc, node: resolved.node }, `${label}.additionalOperations.${method} must be an object.`);
        }
      }
    }
  }
}

function checkCallbackObject(ctx: RuleContext, doc: OasisDocument, node: Node, label: string): void {
  if (!isMap(node)) {
    ctx.report({ doc, node }, `${label} must be an object.`);
    return;
  }

  for (const pair of node.items) {
    const key = keyToString(pair.key);
    if (key.startsWith("x-")) continue;

    if (key === "") {
      ctx.report({ doc, node: isNode(pair.key) ? pair.key : node }, `${label} has an empty callback expression key.`);
    } else if (!RUNTIME_EXPRESSION.test(key) && !URL_LIKE.test(key)) {
      ctx.report(
        { doc, node: isNode(pair.key) ? pair.key : node },
        `${label} key "${key}" does not look like a runtime expression (e.g. containing "{$request.body#/...}") or a URL.`,
      );
    }

    if (!isNode(pair.value)) continue;
    const resolved = resolveMaybeRef(ctx.graph, doc, pair.value, "");
    checkCallbackPathItem(ctx, resolved.doc, resolved.node, `${label} "${key}"`);
  }
}

export const structureCallbacks: Rule = {
  name: "structure/callbacks",
  description:
    'Checks Callback Objects (operation-level "callbacks" and "components/callbacks"): each expression key looks like a runtime expression or URL, and each mapped Path Item Object has only valid HTTP-method/metadata keys with operations that at least declare "responses".',
  defaultSeverity: "error",
  check(ctx) {
    const seen = new Set<string>();

    const visit = (doc: OasisDocument, node: Node, pointer: string, label: string): void => {
      visitResolvedUnique(ctx.graph, seen, doc, node, pointer, (d, n) => checkCallbackObject(ctx, d, n, label));
    };

    for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
      const callbacksNode = childAt(op.node, "callbacks");
      if (!isMap(callbacksNode)) continue;
      for (const pair of callbacksNode.items) {
        const name = keyToString(pair.key);
        if (!isNode(pair.value)) continue;
        visit(
          op.doc,
          pair.value,
          `${op.pointer}/callbacks/${name}`,
          `Callback "${name}" (operation "${op.method.toUpperCase()} ${op.pathItem.template}")`,
        );
      }
    }

    for (const doc of ctx.documents) {
      const root = doc.yamlDoc.contents;
      if (!root || !isMap(root)) continue;
      const componentsNode = childAt(root, "components");
      if (!componentsNode || !isMap(componentsNode)) continue;
      const callbacksNode = childAt(componentsNode, "callbacks");
      if (!isMap(callbacksNode)) continue;
      for (const pair of callbacksNode.items) {
        const name = keyToString(pair.key);
        if (!isNode(pair.value)) continue;
        visit(doc, pair.value, `/components/callbacks/${name}`, `"components/callbacks" "${name}"`);
      }
    }
  },
};
