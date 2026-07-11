import { isMap, isNode } from "yaml";
import type { Node, Pair } from "yaml";
import type { OasisDocument, WorkspaceGraph } from "@oasis/core";
import { childAt, keyToString, resolveMaybeRef } from "./util.ts";

export const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Non-method keys that are legal directly under a Path Item Object. */
export const PATH_ITEM_NON_METHOD_KEYS = new Set(["$ref", "summary", "description", "servers", "parameters"]);

export interface PathItemInfo {
  /** The path template as written in the `paths` map, e.g. "/pets/{id}". */
  template: string;
  /** The key node for the path template, always in `entryDoc`. */
  keyNode: Node | undefined;
  /** The (possibly $ref-resolved) document/node/pointer of the path item body. */
  doc: OasisDocument;
  node: Node;
  pointer: string;
}

/** Enumerate every entry of the entry document's top-level `paths` map, following a top-level $ref if present. */
export function iteratePathItems(graph: WorkspaceGraph, entryDoc: OasisDocument): PathItemInfo[] {
  const root = entryDoc.yamlDoc.contents;
  if (!isNode(root) || !isMap(root)) return [];
  const pathsPair = root.items.find((p) => keyToString(p.key) === "paths");
  if (!pathsPair || !isNode(pathsPair.value) || !isMap(pathsPair.value)) return [];

  const results: PathItemInfo[] = [];
  for (const pair of pathsPair.value.items as Pair[]) {
    const template = keyToString(pair.key);
    if (!isNode(pair.value)) continue;
    const resolved = resolveMaybeRef(graph, entryDoc, pair.value, `/paths/${template}`);
    results.push({
      template,
      keyNode: isNode(pair.key) ? pair.key : undefined,
      doc: resolved.doc,
      node: resolved.node,
      pointer: resolved.pointer,
    });
  }
  return results;
}

export interface OperationInfo {
  method: HttpMethod;
  pathItem: PathItemInfo;
  doc: OasisDocument;
  node: Node;
  pointer: string;
}

/** Enumerate every HTTP-method operation under every path item. */
export function iterateOperations(graph: WorkspaceGraph, entryDoc: OasisDocument): OperationInfo[] {
  const results: OperationInfo[] = [];
  for (const pathItem of iteratePathItems(graph, entryDoc)) {
    if (!isMap(pathItem.node)) continue;
    for (const method of HTTP_METHODS) {
      const child = childAt(pathItem.node, method);
      if (!child) continue;
      const resolved = resolveMaybeRef(graph, pathItem.doc, child, `${pathItem.pointer}/${method}`);
      results.push({ method, pathItem, doc: resolved.doc, node: resolved.node, pointer: resolved.pointer });
    }
  }
  return results;
}
