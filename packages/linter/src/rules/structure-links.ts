import { isMap, isNode, isScalar } from "yaml";
import type { Node } from "yaml";
import { isExternalUriReference, resolveRef } from "@oasis/core";
import type { OasisDocument } from "@oasis/core";
import { iterateOperations } from "../openapi-walk.ts";
import { childAt, keyToString, resolveMaybeRef, visitResolvedUnique } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

const ALLOWED_LINK_KEYS = new Set(["operationRef", "operationId", "parameters", "requestBody", "description", "server"]);

interface ResponseSite {
  doc: OasisDocument;
  node: Node;
  pointer: string;
  label: string;
}

/** Every Response Object reachable from `components/responses` and every operation's `responses`. */
function collectResponseObjects(ctx: RuleContext): ResponseSite[] {
  const seen = new Set<string>();
  const results: ResponseSite[] = [];

  function add(doc: OasisDocument, node: Node, pointer: string, label: string): void {
    const resolved = resolveMaybeRef(ctx.graph, doc, node, pointer);
    if (!isMap(resolved.node)) return;
    const key = `${resolved.doc.filePath}::${resolved.pointer}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ doc: resolved.doc, node: resolved.node, pointer: resolved.pointer, label });
  }

  for (const doc of ctx.documents) {
    const root = doc.yamlDoc.contents;
    if (!root || !isMap(root)) continue;
    const components = childAt(root, "components");
    if (!components || !isMap(components)) continue;
    const responsesNode = childAt(components, "responses");
    if (!isMap(responsesNode)) continue;
    for (const pair of responsesNode.items) {
      const name = keyToString(pair.key);
      if (!isNode(pair.value)) continue;
      add(doc, pair.value, `/components/responses/${name}`, `"components/responses" "${name}"`);
    }
  }

  for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
    if (!isMap(op.node)) continue;
    const responsesNode = childAt(op.node, "responses");
    if (!isMap(responsesNode)) continue;
    for (const pair of responsesNode.items) {
      const status = keyToString(pair.key);
      if (!isNode(pair.value)) continue;
      add(
        op.doc,
        pair.value,
        `${op.pointer}/responses/${status}`,
        `Operation "${op.method.toUpperCase()} ${op.pathItem.template}" response "${status}"`,
      );
    }
  }

  return results;
}

/** Every operationId declared in the workspace (paths, and on 3.1, webhooks). */
function collectOperationIds(ctx: RuleContext): Set<string> {
  const ids = new Set<string>();
  for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
    const idNode = childAt(op.node, "operationId");
    if (isScalar(idNode) && typeof idNode.value === "string") ids.add(idNode.value);
  }
  return ids;
}

/**
 * The AST node of every Operation Object in the workspace (paths, and on 3.1, webhooks), at its
 * final (post-$ref) location. Used to verify that a Link Object's `operationRef` resolves to an
 * actual Operation Object, not merely to *some* node. Node identity (rather than a `pointer`
 * string) is the comparison key: `iterateOperations`' `pointer` field embeds the raw path template
 * unescaped (so e.g. "/pets" becomes the ill-formed JSON Pointer segment "/paths//pets/get"), which
 * doesn't line up with the properly RFC 6901-escaped pointer `resolveRef` returns for the same
 * target ("/paths/~1pets/get"); the underlying AST node objects, however, are the same instance
 * either way.
 */
function collectOperationNodes(ctx: RuleContext): Set<Node> {
  const nodes = new Set<Node>();
  for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
    nodes.add(op.node);
  }
  return nodes;
}

function checkLinkObject(
  ctx: RuleContext,
  doc: OasisDocument,
  node: Node,
  label: string,
  operationIds: Set<string>,
  operationNodes: Set<Node>,
): void {
  if (!isMap(node)) {
    ctx.report({ doc, node }, `${label} must be an object.`);
    return;
  }

  for (const pair of node.items) {
    const key = keyToString(pair.key);
    if (key.startsWith("x-")) continue;
    if (!ALLOWED_LINK_KEYS.has(key) && isNode(pair.key)) {
      ctx.report(
        { doc, node: pair.key },
        `${label} has unknown key "${key}"; expected one of: ${[...ALLOWED_LINK_KEYS].join(", ")}.`,
      );
    }
  }

  const operationRefNode = childAt(node, "operationRef");
  const operationIdNode = childAt(node, "operationId");
  const hasRef = !!operationRefNode;
  const hasId = !!operationIdNode;

  if (hasRef && hasId) {
    ctx.report({ doc, node }, `${label} must not set both "operationRef" and "operationId".`);
  } else if (!hasRef && !hasId) {
    ctx.report({ doc, node }, `${label} must set exactly one of "operationRef" or "operationId".`);
  }

  if (hasId) {
    if (!isScalar(operationIdNode) || typeof operationIdNode.value !== "string") {
      ctx.report({ doc, node: operationIdNode }, `${label} "operationId" must be a string.`);
    } else if (!operationIds.has(operationIdNode.value)) {
      ctx.report(
        { doc, node: operationIdNode },
        `${label} "operationId" "${operationIdNode.value}" does not match any operationId in the workspace.`,
      );
    }
  }

  if (hasRef) {
    if (!isScalar(operationRefNode) || typeof operationRefNode.value !== "string") {
      ctx.report({ doc, node: operationRefNode }, `${label} "operationRef" must be a string.`);
    } else {
      const value = operationRefNode.value;
      // An operationRef targeting an external URI (`https:`, `urn:`, …) or a scheme-relative URL
      // (`//host/…`) points outside the workspace and cannot be verified locally; the spec allows
      // such references, so leave them unchecked (same classification `classifyMappingValue` uses).
      if (isExternalUriReference(value) || value.startsWith("//")) return;
      const result = resolveRef(ctx.graph, doc, value);
      if (!result.ok) {
        ctx.report({ doc, node: operationRefNode }, `${label} "operationRef" "${value}" does not resolve in the workspace.`);
      } else if (!operationNodes.has(result.node)) {
        ctx.report(
          { doc, node: operationRefNode },
          `${label} "operationRef" "${value}" must resolve to an Operation Object.`,
        );
      }
    }
  }
}

export const structureLinks: Rule = {
  name: "structure/links",
  description:
    'Checks Link Objects (Response Object "links" and "components/links"): exactly one of "operationRef"/"operationId" is set, "operationId" matches an operationId in the workspace, "operationRef" resolves in-graph to an Operation Object (an HTTP-method child of a Path Item under "paths" or, on 3.1, "webhooks"), and only known keys are used.',
  defaultSeverity: "error",
  check(ctx) {
    const operationIds = collectOperationIds(ctx);
    const operationNodes = collectOperationNodes(ctx);
    const seen = new Set<string>();

    const visit = (doc: OasisDocument, node: Node, pointer: string, label: string): void => {
      visitResolvedUnique(ctx.graph, seen, doc, node, pointer, (d, n) => checkLinkObject(ctx, d, n, label, operationIds, operationNodes));
    };

    for (const doc of ctx.documents) {
      const root = doc.yamlDoc.contents;
      if (!root || !isMap(root)) continue;
      const components = childAt(root, "components");
      if (!components || !isMap(components)) continue;
      const linksNode = childAt(components, "links");
      if (!isMap(linksNode)) continue;
      for (const pair of linksNode.items) {
        const name = keyToString(pair.key);
        if (!isNode(pair.value)) continue;
        visit(doc, pair.value, `/components/links/${name}`, `"components/links" "${name}"`);
      }
    }

    for (const response of collectResponseObjects(ctx)) {
      const linksNode = childAt(response.node, "links");
      if (!isMap(linksNode)) continue;
      for (const pair of linksNode.items) {
        const name = keyToString(pair.key);
        if (!isNode(pair.value)) continue;
        visit(response.doc, pair.value, `${response.pointer}/links/${name}`, `${response.label} link "${name}"`);
      }
    }
  },
};
