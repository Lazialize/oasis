import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "./parse.ts";
import type { Range } from "./types.ts";
import { rangeFromOffsets } from "./position.ts";
import { formatPointer, parsePointer } from "./pointer.ts";
import { childAt, keyToString } from "./walk.ts";
import { resolveUriReference, stripUriFragment } from "./uri.ts";

export interface PointerLookupResult {
  node: Node;
  range: Range;
}

/** Resolve a JSON Pointer (e.g. "/paths/~1users/get") to the AST node + range at that location. */
export function nodeAtPointer(doc: OasisDocument, pointer: string): PointerLookupResult | undefined {
  const root = doc.yamlDoc.contents;
  if (!isNode(root)) return undefined;

  return nodeAtPointerFrom(doc, root, pointer);
}

/** Resolve a JSON Pointer relative to an embedded JSON Schema resource root. */
export function nodeAtPointerFrom(doc: OasisDocument, root: Node, pointer: string): PointerLookupResult | undefined {
  const segments = parsePointer(pointer);
  let current: Node = root;
  for (const seg of segments) {
    const next = childAt(current, seg, doc.yamlDoc);
    if (!next) return undefined;
    current = next;
  }
  return nodeToResult(current, doc);
}

/**
 * Recover the canonical base at one concrete JSON Pointer occurrence. Unlike a node-identity map,
 * this distinguishes the same YAML alias target reached below different `$id` ancestors.
 */
export function resourceBaseAtPointer(doc: OasisDocument, root: Node, pointer: string, initialBaseUri: string): string {
  let current: Node = root;
  let baseUri = initialBaseUri;
  for (const segment of parsePointer(pointer)) {
    const next = childAt(current, segment, doc.yamlDoc);
    if (!next) break;
    current = next;
    if (!isMap(current)) continue;
    const idPair = current.items.find((pair) => isScalar(pair.key) && pair.key.value === "$id");
    if (isScalar(idPair?.value) && typeof idPair.value.value === "string") {
      baseUri = stripUriFragment(resolveUriReference(baseUri, idPair.value.value));
    }
  }
  return baseUri;
}

/**
 * Recover the base active immediately before the JSON Pointer target applies its own `$id`.
 * `initialBaseUri` is the effective base of `root`; ancestor `$id`s below `root` are applied, but
 * the final target is deliberately excluded so a scoped traversal can process its `$id` once.
 */
export function resourceBaseBeforePointerTarget(
  doc: OasisDocument,
  root: Node,
  pointer: string,
  initialBaseUri: string,
): string {
  let current: Node = root;
  let baseUri = initialBaseUri;
  const segments = parsePointer(pointer);
  for (let index = 0; index < segments.length - 1; index++) {
    const next = childAt(current, segments[index]!, doc.yamlDoc);
    if (!next) break;
    current = next;
    if (!isMap(current)) continue;
    const idPair = current.items.find((pair) => isScalar(pair.key) && pair.key.value === "$id");
    if (isScalar(idPair?.value) && typeof idPair.value.value === "string") {
      baseUri = stripUriFragment(resolveUriReference(baseUri, idPair.value.value));
    }
  }
  return baseUri;
}

function nodeToResult(node: Node, doc: OasisDocument): PointerLookupResult | undefined {
  const range = node.range;
  if (!range) return undefined;
  return {
    node,
    range: rangeFromOffsets(doc.filePath, doc.lineCounter, range[0], range[1]),
  };
}

export interface PositionLookupResult {
  node: Node;
  pointer: string;
  range: Range;
}

/** Find the deepest AST node containing `offset`, along with its JSON Pointer. */
export function nodeAtPosition(doc: OasisDocument, offset: number): PositionLookupResult | undefined {
  const root = doc.yamlDoc.contents;
  if (!isNode(root) || !root.range) return undefined;
  if (offset < root.range[0] || offset > root.range[1]) return undefined;

  let bestNode: Node = root;
  let bestSegments: string[] = [];
  let current: Node = root;

  for (;;) {
    const found = findContainingChild(current, offset);
    if (!found) break;
    bestNode = found.node;
    bestSegments = [...bestSegments, found.segment];
    current = found.node;
  }

  const result = nodeToResult(bestNode, doc);
  if (!result) return undefined;
  return { node: result.node, pointer: formatPointer(bestSegments), range: result.range };
}

function findContainingChild(node: Node, offset: number): { node: Node; segment: string } | undefined {
  if (isMap(node)) {
    for (const pair of node.items) {
      const key = pair.key;
      // A cursor on the key text itself (e.g. the "$ref" in "$ref: ./foo.yaml") previously fell
      // through to nothing, so the search stopped one level short and returned the *containing
      // map* instead of this pair. Map it to the pair's own pointer, same as landing on the value
      // — that's what keeps pointer-based consumers (e.g. `endsWith("/$ref")` ref detection,
      // component-target resolution) working the same whether the cursor is on the key or the
      // value. Fall back to the key node itself when there's no value node to point at (e.g. a
      // key typed with no value yet).
      if (isNode(key) && key.range && offset >= key.range[0] && offset <= key.range[1]) {
        const value = pair.value;
        return { node: isNode(value) ? value : key, segment: keyToString(key) };
      }
      const value = pair.value;
      if (isNode(value) && value.range && offset >= value.range[0] && offset <= value.range[1]) {
        return { node: value, segment: keyToString(pair.key) };
      }
    }
  } else if (isSeq(node)) {
    for (let idx = 0; idx < node.items.length; idx++) {
      const item = node.items[idx];
      if (isNode(item) && item.range && offset >= item.range[0] && offset <= item.range[1]) {
        return { node: item, segment: String(idx) };
      }
    }
  }
  return undefined;
}
