import { isMap, isScalar } from "yaml";
import type { Node } from "yaml";
import { childAt, keyToString, nodeAtPointer, resolveRef } from "@oasis/core";
import type { OasisDocument, WorkspaceGraph } from "@oasis/core";

export { childAt, keyToString };

/** A valid Responses Object key: an HTTP status code, an uppercase status range ("2XX"), or "default". */
export const RESPONSE_STATUS_CODE_PATTERN = /^(default|[1-5](\d{2}|XX))$/;

/**
 * Whether a Responses Object (`node`) has at least one entry that's legal per the OpenAPI spec: a
 * response code, "default", or an extension ("x-*") field. An operation/callback whose `responses`
 * map has none of these (most commonly `responses: {}`) can never be satisfied by any client.
 */
export function hasAnyResponseEntry(node: Node): boolean {
  if (!isMap(node)) return false;
  return node.items.some((pair) => {
    const key = keyToString(pair.key);
    return RESPONSE_STATUS_CODE_PATTERN.test(key) || key.startsWith("x-");
  });
}

/** Whether `node` is a YAML map carrying a `$ref` key (a Reference Object). */
export function isRefObject(node: Node): boolean {
  return isMap(node) && node.items.some((p) => keyToString(p.key) === "$ref");
}

export interface ResolvedLocation {
  doc: OasisDocument;
  node: Node;
  pointer: string;
}

/**
 * If `node` is a YAML map containing a `$ref` key, resolve it against the workspace graph and
 * return the target location. Otherwise return the location unchanged. Reference chains are
 * followed until a concrete (non-`$ref`) target is reached, resolution fails, or a Reference Object
 * already visited on this chain proves a cycle — there is no fixed hop limit, so an acyclic chain of
 * any length resolves fully. On a cycle or unresolved link the last reachable location is returned.
 */
export function resolveMaybeRef(
  graph: WorkspaceGraph,
  doc: OasisDocument,
  node: Node,
  pointer: string,
): ResolvedLocation {
  let current: ResolvedLocation = { doc, node, pointer };
  const visited = new Set<Node>();
  for (;;) {
    if (!isMap(current.node)) return current;
    const refPair = current.node.items.find((p) => keyToString(p.key) === "$ref");
    if (!refPair || !isScalar(refPair.value) || typeof refPair.value.value !== "string") return current;
    // A Reference Object seen twice on this chain means the chain loops back on itself.
    if (visited.has(current.node)) return current;
    visited.add(current.node);
    const result = resolveRef(graph, current.doc, refPair.value.value, undefined);
    if (!result.ok) return current;
    current = { doc: result.doc, node: result.node, pointer: result.pointer };
  }
}

/** Get the node at `pointer` in `doc`, if any, without following $refs. */
export function nodeAt(doc: OasisDocument, pointer: string): Node | undefined {
  return nodeAtPointer(doc, pointer)?.node;
}

/** Whether a mapping/discriminator value (an absolute URI) is an external target rather than an in-workspace pointer. */
export function isUrlLike(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) || value.startsWith("//");
}

/**
 * Resolve `node`'s `$ref` (if any) through the workspace graph and, if this resolved location
 * hasn't been visited before (deduplicated by `filePath::pointer`, tracked in `seen`), call `visit`
 * with it. Guards against a `$ref`'d object (a callback, link, or security scheme reused across
 * several operations, or also registered under `components/*`) being checked more than once, and
 * against non-map resolution targets (unresolved/external `$ref`s).
 */
export function visitResolvedUnique(
  graph: WorkspaceGraph,
  seen: Set<string>,
  doc: OasisDocument,
  node: Node,
  pointer: string,
  visit: (doc: OasisDocument, node: Node, pointer: string) => void,
): void {
  const resolved = resolveMaybeRef(graph, doc, node, pointer);
  if (!isMap(resolved.node)) return;
  const key = `${resolved.doc.filePath}::${resolved.pointer}`;
  if (seen.has(key)) return;
  seen.add(key);
  visit(resolved.doc, resolved.node, resolved.pointer);
}

/**
 * Normalize a `discriminator.mapping` / component-name-ish value to a `$ref`-style string: values
 * already containing a `#` (a pointer or `file.yaml#/...` reference) are used as-is, bare names are
 * expanded to `#/components/schemas/<name>` per the OpenAPI spec's shorthand for mapping values.
 */
export function toSchemaRefString(value: string): string {
  return value.includes("#") ? value : `#/components/schemas/${value}`;
}
