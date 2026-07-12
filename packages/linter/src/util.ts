import { isMap, isScalar } from "yaml";
import type { Node } from "yaml";
import { childAt, keyToString, nodeAtPointer, resolveRef } from "@oasis/core";
import type { OasisDocument, WorkspaceGraph } from "@oasis/core";

export { childAt, keyToString };

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
 * return the target location. Otherwise return the location unchanged. Follows chained refs up
 * to a small depth to guard against surprises (the graph itself already guards against cycles).
 */
export function resolveMaybeRef(
  graph: WorkspaceGraph,
  doc: OasisDocument,
  node: Node,
  pointer: string,
): ResolvedLocation {
  let current: ResolvedLocation = { doc, node, pointer };
  for (let depth = 0; depth < 10; depth++) {
    if (!isMap(current.node)) return current;
    const refPair = current.node.items.find((p) => keyToString(p.key) === "$ref");
    if (!refPair || !isScalar(refPair.value) || typeof refPair.value.value !== "string") return current;
    const result = resolveRef(graph, current.doc, refPair.value.value, undefined);
    if (!result.ok) return current;
    current = { doc: result.doc, node: result.node, pointer: result.pointer };
  }
  return current;
}

/** Get the node at `pointer` in `doc`, if any, without following $refs. */
export function nodeAt(doc: OasisDocument, pointer: string): Node | undefined {
  return nodeAtPointer(doc, pointer)?.node;
}
