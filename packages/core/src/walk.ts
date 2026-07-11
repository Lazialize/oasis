import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";

/** The string form of a map key, as used for JSON Pointer segments. */
export function keyToString(key: unknown): string {
  if (isScalar(key)) return String(key.value);
  return String(key);
}

/**
 * Depth-first walk over a composed yaml AST, visiting every child node (map values and
 * sequence items) along with the JSON Pointer segments leading to it. Does not visit `node`
 * itself, only its descendants.
 */
export function walkChildren(node: unknown, visit: (child: Node, segments: string[]) => void, segments: string[] = []): void {
  if (isMap(node)) {
    for (const pair of node.items) {
      const value = pair.value;
      const segs = [...segments, keyToString(pair.key)];
      if (isNode(value)) {
        visit(value, segs);
        walkChildren(value, visit, segs);
      }
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, idx) => {
      const segs = [...segments, String(idx)];
      if (isNode(item)) {
        visit(item, segs);
        walkChildren(item, visit, segs);
      }
    });
  }
}
