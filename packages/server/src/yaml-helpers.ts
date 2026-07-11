import { isMap, isScalar } from "yaml";
import type { Node, YAMLMap } from "yaml";

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
