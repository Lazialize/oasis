import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { nodeAtPointer, resolveRef } from "@oasis/core";
import type { OasisDocument, WorkspaceGraph } from "@oasis/core";

/** The string form of a map key. */
export function keyToString(key: unknown): string {
  if (isScalar(key)) return String(key.value);
  return String(key);
}

/** Look up a direct child of a YAML map/seq node by key/index, without following $refs. */
export function childAt(node: Node, segment: string): Node | undefined {
  if (isMap(node)) {
    const pair = node.items.find((p) => keyToString(p.key) === segment);
    if (!pair || !isNode(pair.value)) return undefined;
    return pair.value;
  }
  if (isSeq(node)) {
    const idx = Number(segment);
    if (!Number.isInteger(idx)) return undefined;
    const item = node.items[idx];
    if (!isNode(item)) return undefined;
    return item;
  }
  return undefined;
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
