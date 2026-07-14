import { isAlias, isMap, isNode, isScalar, isSeq } from "yaml";
import type { Document as YamlDocument, Node } from "yaml";

const ownerDocuments = new WeakMap<Node, YamlDocument>();

/** Register the owning YAML document for every physical AST node. */
export function registerNodeDocument(root: Node, doc: YamlDocument): void {
  const seen = new Set<Node>();
  walk(root);

  function walk(node: Node): void {
    if (seen.has(node)) return;
    seen.add(node);
    ownerDocuments.set(node, doc);
    if (isMap(node)) {
      for (const pair of node.items) {
        if (isNode(pair.key)) walk(pair.key);
        if (isNode(pair.value)) walk(pair.value);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        if (isNode(item)) walk(item);
      }
    }
  }
}

/** The string form of a map key, as used for JSON Pointer segments. */
export function keyToString(key: unknown): string {
  if (isScalar(key)) return String(key.value);
  return String(key);
}

/**
 * Resolve a YAML `Alias` node (`*anchor`, including merge-key values) to its anchored target within
 * `doc`. Non-alias nodes are returned unchanged. Follows alias-to-alias chains and returns
 * `undefined` for a dangling anchor or a cyclic alias chain (guarded by `seen`).
 *
 * Range semantics: the returned node is the *anchor target*, so an aliased value is treated as the
 * value it stands for — its source range points at the anchored definition, never lost.
 */
export function resolveAlias(node: Node, doc?: YamlDocument, seen: Set<Node> = new Set()): Node | undefined {
  const owningDoc = doc ?? ownerDocuments.get(node);
  let current: Node = node;
  while (isAlias(current)) {
    if (!owningDoc) return undefined;
    if (seen.has(current)) return undefined;
    seen.add(current);
    const target = current.resolve(owningDoc);
    if (!target) return undefined;
    current = target;
  }
  return current;
}

/**
 * Depth-first visitor over every node in a YAML tree, resolving `Alias` nodes to their anchored
 * targets as it descends — so values reachable only through a `*alias` or `<<` merge key are still
 * visited. `visit` is called once per physical node (a shared anchor reused by several aliases, and
 * cyclic aliases, are both bounded by an identity seen-set). Callers inspect `.items` themselves.
 */
export function walkNodes(root: Node, doc: YamlDocument, visit: (node: Node) => void): void {
  const seen = new Set<Node>();
  walk(root);

  function walk(node: Node): void {
    const resolved = resolveAlias(node, doc);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    visit(resolved);
    if (isMap(resolved)) {
      for (const pair of resolved.items) {
        if (isNode(pair.value)) walk(pair.value);
      }
    } else if (isSeq(resolved)) {
      for (const item of resolved.items) {
        if (isNode(item)) walk(item);
      }
    }
  }
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

/**
 * Look up a direct child of a YAML map/seq node by key/index, without following $refs. When `doc`
 * is supplied, an `Alias` node (and aliased children) is resolved to its anchored target first, so
 * pointer traversal descends through `*alias` / merge-key values.
 */
export function childAt(node: Node, segment: string, doc?: YamlDocument): Node | undefined {
  const owningDoc = doc ?? ownerDocuments.get(node);
  if (!owningDoc) return childAtDirect(node, segment);
  const container = resolveAlias(node, owningDoc);
  if (!container) return undefined;
  return childAtWithMerges(container, segment, owningDoc, new Set());
}

function childAtWithMerges(node: Node, segment: string, doc: YamlDocument, seen: Set<Node>): Node | undefined {
  const container = resolveAlias(node, doc);
  if (!container || seen.has(container)) return undefined;
  seen.add(container);

  const direct = childAtDirect(container, segment);
  if (direct) return resolveAlias(direct, doc);
  if (!isMap(container)) return undefined;

  for (const pair of container.items) {
    if (keyToString(pair.key) !== "<<" || !isNode(pair.value)) continue;
    const merged = resolveAlias(pair.value, doc);
    if (!merged) continue;
    if (isMap(merged)) {
      const found = childAtWithMerges(merged, segment, doc, seen);
      if (found) return found;
    } else if (isSeq(merged)) {
      for (const item of merged.items) {
        if (!isNode(item)) continue;
        const found = childAtWithMerges(item, segment, doc, seen);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function childAtDirect(node: Node, segment: string): Node | undefined {
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
