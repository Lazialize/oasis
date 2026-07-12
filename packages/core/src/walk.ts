import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";

/** The string form of a map key, as used for JSON Pointer segments. */
export function keyToString(key: unknown): string {
  if (isScalar(key)) return String(key.value);
  return String(key);
}

const SEQ_INDEX_RE = /^(0|[1-9]\d*)$/;

/**
 * Per-map key index, built lazily on first lookup and cached by map node identity. The YAML AST
 * is immutable once parsed, so a node's own `items` never change and the index never goes stale.
 * `nodeAtPointer` (and everything built on it, e.g. `$ref` resolution) walks a pointer one map
 * lookup per segment; large maps like `components/schemas` are looked into repeatedly — once per
 * `$ref` that targets an entry in them — so caching turns each of those from an O(n) linear scan
 * into an O(1) lookup after the first.
 */
const mapKeyIndexCache = new WeakMap<Node, Map<string, Node>>();

function mapKeyIndex(node: Node & { items: readonly { key: unknown; value: unknown }[] }): Map<string, Node> {
  const cached = mapKeyIndexCache.get(node);
  if (cached) return cached;

  const index = new Map<string, Node>();
  for (const pair of node.items) {
    if (!isNode(pair.value)) continue;
    const key = keyToString(pair.key);
    // First occurrence wins, matching `Array.prototype.find`'s behavior on duplicate keys.
    if (!index.has(key)) index.set(key, pair.value);
  }
  mapKeyIndexCache.set(node, index);
  return index;
}

/** Look up a direct child of a YAML map/seq node by key/index, without following $refs. */
export function childAt(node: Node, segment: string): Node | undefined {
  if (isMap(node)) {
    return mapKeyIndex(node).get(segment);
  }
  if (isSeq(node)) {
    if (!SEQ_INDEX_RE.test(segment)) return undefined;
    const idx = Number(segment);
    const item = node.items[idx];
    if (!isNode(item)) return undefined;
    return item;
  }
  return undefined;
}
