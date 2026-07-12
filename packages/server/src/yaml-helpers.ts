import { isMap, isScalar } from "yaml";
import type { Node, YAMLMap } from "yaml";
import { rangeFromOffsets } from "@oasis/core";
import type { OasisDocument, Range } from "@oasis/core";

/**
 * `node`'s range as an LSP-ish `Range`, from the start of its content to the end of its own
 * content (`node.range[1]`) — deliberately *not* `node.range[2]`, which includes trailing
 * whitespace/comments the node doesn't semantically own (e.g. a blank line or a comment before the
 * next sibling). Using `range[1]` keeps symbol ranges tight around the node they describe. Falls
 * back to a zero-width range at the start of the document if the node has no range (shouldn't
 * happen for a parsed node, but the `yaml` library's `range` field is optional).
 */
export function nodeRange(doc: OasisDocument, node: Node): Range {
  const range = node.range;
  return range ? rangeFromOffsets(doc.filePath, doc.lineCounter, range[0], range[1]) : rangeFromOffsets(doc.filePath, doc.lineCounter, 0, 0);
}

/** Existing string keys on a map node, or []  if `node` is not a map. */
export function mapKeys(node: Node | undefined): string[] {
  if (!node || !isMap(node)) return [];
  return node.items.map((p) => (isScalar(p.key) ? String(p.key.value) : String(p.key))).filter((k): k is string => typeof k === "string");
}

/** The string value of `node.key`, or undefined if it doesn't have one. */
export function getChildScalar(node: Node | undefined, key: string): string | undefined {
  if (!node || !isMap(node)) return undefined;
  const pair = (node as YAMLMap).items.find((p) => isScalar(p.key) && String(p.key.value) === key);
  if (!pair || !isScalar(pair.value)) return undefined;
  const value = pair.value.value;
  return typeof value === "string" ? value : value === undefined || value === null ? undefined : String(value);
}

export function getChildNode(node: Node | undefined, key: string): Node | undefined {
  if (!node || !isMap(node)) return undefined;
  const pair = (node as YAMLMap).items.find((p) => isScalar(p.key) && String(p.key.value) === key);
  const value = pair?.value;
  return value && typeof value === "object" && "range" in (value as object) ? (value as Node) : undefined;
}
