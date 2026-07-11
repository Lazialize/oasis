import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";

/** The string form of a map key, as used for JSON Pointer segments. */
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
    if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
    const idx = Number(segment);
    const item = node.items[idx];
    if (!isNode(item)) return undefined;
    return item;
  }
  return undefined;
}
