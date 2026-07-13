import { isMap, isNode, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "./parse.ts";
import type { Range } from "./types.ts";
import { rangeFromOffsets } from "./position.ts";
import { formatPointer, parsePointer } from "./pointer.ts";
import { childAt, keyToString } from "./walk.ts";

export interface PointerLookupResult {
  node: Node;
  range: Range;
}

/** Resolve a JSON Pointer (e.g. "/paths/~1users/get") to the AST node + range at that location. */
export function nodeAtPointer(doc: OasisDocument, pointer: string): PointerLookupResult | undefined {
  const segments = parsePointer(pointer);
  const root = doc.yamlDoc.contents;
  if (!isNode(root)) return undefined;

  let current: Node = root;
  for (const seg of segments) {
    const next = childAt(current, seg, doc.yamlDoc);
    if (!next) return undefined;
    current = next;
  }
  return nodeToResult(current, doc);
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
