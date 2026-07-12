import { isMap, isNode, isSeq } from "yaml";
import type { Node, Pair } from "yaml";
import type { OasisDocument, OpenApiVersion, WorkspaceGraph } from "@oasis/core";
import { childAt, keyToString, resolveMaybeRef } from "./util.ts";

export const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Non-method keys that are legal directly under a Path Item Object. */
export const PATH_ITEM_NON_METHOD_KEYS = new Set(["$ref", "summary", "description", "servers", "parameters"]);

/** Which root map a path item came from. `webhooks` is 3.1-only. */
export type PathItemOrigin = "paths" | "webhooks";

export interface PathItemInfo {
  /** The map key: a path template (e.g. "/pets/{id}") for `paths`, an arbitrary name for `webhooks`. */
  template: string;
  /** Whether this entry came from the root `paths` or (3.1) `webhooks` map. */
  origin: PathItemOrigin;
  /** The key node for the path template, always in `entryDoc`. */
  keyNode: Node | undefined;
  /** The (possibly $ref-resolved) document/node/pointer of the path item body. */
  doc: OasisDocument;
  node: Node;
  pointer: string;
}

/**
 * Enumerate every entry of the entry document's top-level `paths` map, following a top-level $ref
 * if present. When `version` is "3.1", entries of the root `webhooks` map are included too (on
 * 3.0 documents `webhooks` is not a spec key; flagging it is left to structure rules).
 */
export function iteratePathItems(graph: WorkspaceGraph, entryDoc: OasisDocument, version?: OpenApiVersion): PathItemInfo[] {
  const root = entryDoc.yamlDoc.contents;
  if (!isNode(root) || !isMap(root)) return [];

  const origins: PathItemOrigin[] = version === "3.1" ? ["paths", "webhooks"] : ["paths"];
  const results: PathItemInfo[] = [];

  for (const origin of origins) {
    const sectionPair = root.items.find((p) => keyToString(p.key) === origin);
    if (!sectionPair || !isNode(sectionPair.value) || !isMap(sectionPair.value)) continue;

    for (const pair of sectionPair.value.items as Pair[]) {
      const template = keyToString(pair.key);
      if (!isNode(pair.value)) continue;
      const resolved = resolveMaybeRef(graph, entryDoc, pair.value, `/${origin}/${template}`);
      results.push({
        template,
        origin,
        keyNode: isNode(pair.key) ? pair.key : undefined,
        doc: resolved.doc,
        node: resolved.node,
        pointer: resolved.pointer,
      });
    }
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

/**
 * Enumerate every HTTP-method operation under every path item. When `version` is "3.1",
 * operations under the root `webhooks` map are included (see `iteratePathItems`).
 */
export function iterateOperations(graph: WorkspaceGraph, entryDoc: OasisDocument, version?: OpenApiVersion): OperationInfo[] {
  const results: OperationInfo[] = [];
  for (const pathItem of iteratePathItems(graph, entryDoc, version)) {
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

/** A site where a Schema Object starts: the (possibly $ref-resolved) schema root node. */
export interface SchemaSite {
  doc: OasisDocument;
  /** The resolved schema root node (always a YAML map). */
  node: Node;
  pointer: string;
}

/**
 * Enumerate every site where a Schema Object can appear:
 * - `components/schemas` entries (in every loaded document),
 * - parameter and header schemas — direct `schema` or per-media-type under `content` — at the
 *   path-item, operation and components level (including response headers),
 * - request-body and response media-type schemas, at the operation level and under
 *   components-level `requestBodies`/`responses`,
 * - all of the above under the root `webhooks` map on 3.1 documents.
 *
 * `$ref`s to path items / parameters / request bodies / responses / headers / schemas are resolved
 * through the workspace graph; each resolved schema root is yielded once, deduplicated by
 * file + pointer (which also guards against revisits through ref cycles). Recursion *within* a
 * schema (properties, items, allOf, ...) is left to the caller.
 */
export function iterateSchemas(
  graph: WorkspaceGraph,
  entryDoc: OasisDocument,
  documents: OasisDocument[],
  version?: OpenApiVersion,
): SchemaSite[] {
  const seen = new Set<string>();
  const results: SchemaSite[] = [];

  function addSchema(doc: OasisDocument, node: Node, pointer: string): void {
    const resolved = resolveMaybeRef(graph, doc, node, pointer);
    if (!isMap(resolved.node)) return;
    const key = `${resolved.doc.filePath}::${resolved.pointer}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ doc: resolved.doc, node: resolved.node, pointer: resolved.pointer });
  }

  /** Media Type Objects in a `content` map: each one's `schema`. */
  function addFromContent(doc: OasisDocument, contentNode: Node | undefined, pointer: string): void {
    if (!contentNode || !isMap(contentNode)) return;
    for (const pair of contentNode.items) {
      const mediaType = keyToString(pair.key);
      if (!isNode(pair.value) || !isMap(pair.value)) continue;
      const schema = childAt(pair.value, "schema");
      if (schema) addSchema(doc, schema, `${pointer}/${mediaType}/schema`);
    }
  }

  /** A Parameter or Header Object: a direct `schema`, or per-media-type schemas under `content`. */
  function addFromSchemaBearing(doc: OasisDocument, node: Node, pointer: string): void {
    if (!isMap(node)) return;
    const schema = childAt(node, "schema");
    if (schema) addSchema(doc, schema, `${pointer}/schema`);
    addFromContent(doc, childAt(node, "content"), `${pointer}/content`);
  }

  /** A Response Object: media-type schemas under `content`, plus each header's schema. */
  function addFromResponse(doc: OasisDocument, node: Node, pointer: string): void {
    if (!isMap(node)) return;
    addFromContent(doc, childAt(node, "content"), `${pointer}/content`);
    const headers = childAt(node, "headers");
    if (isMap(headers)) {
      for (const pair of headers.items) {
        const name = keyToString(pair.key);
        if (!isNode(pair.value)) continue;
        const resolved = resolveMaybeRef(graph, doc, pair.value, `${pointer}/headers/${name}`);
        addFromSchemaBearing(resolved.doc, resolved.node, resolved.pointer);
      }
    }
  }

  /** A `parameters` array (path-item- or operation-level), resolving $ref entries. */
  function addFromParams(doc: OasisDocument, arrNode: Node | undefined, pointer: string): void {
    if (!arrNode || !isSeq(arrNode)) return;
    arrNode.items.forEach((item, i) => {
      if (!isNode(item)) return;
      const resolved = resolveMaybeRef(graph, doc, item, `${pointer}/${i}`);
      addFromSchemaBearing(resolved.doc, resolved.node, resolved.pointer);
    });
  }

  // Components-level sites, in every loaded document.
  for (const doc of documents) {
    const root = doc.yamlDoc.contents;
    if (!root || !isMap(root)) continue;
    const components = childAt(root, "components");
    if (!components || !isMap(components)) continue;

    const eachEntry = (section: string, visit: (doc: OasisDocument, node: Node, pointer: string) => void): void => {
      const sectionNode = childAt(components, section);
      if (!sectionNode || !isMap(sectionNode)) return;
      for (const pair of sectionNode.items) {
        const name = keyToString(pair.key);
        if (!isNode(pair.value)) continue;
        const resolved = resolveMaybeRef(graph, doc, pair.value, `/components/${section}/${name}`);
        visit(resolved.doc, resolved.node, resolved.pointer);
      }
    };

    eachEntry("schemas", (d, n, p) => addSchema(d, n, p));
    eachEntry("parameters", addFromSchemaBearing);
    eachEntry("headers", addFromSchemaBearing);
    eachEntry("requestBodies", (d, n, p) => {
      if (isMap(n)) addFromContent(d, childAt(n, "content"), `${p}/content`);
    });
    eachEntry("responses", addFromResponse);
  }

  // Operation-level sites, following the paths (and, on 3.1, webhooks) walk.
  for (const pathItem of iteratePathItems(graph, entryDoc, version)) {
    if (!isMap(pathItem.node)) continue;
    addFromParams(pathItem.doc, childAt(pathItem.node, "parameters"), `${pathItem.pointer}/parameters`);
  }
  for (const op of iterateOperations(graph, entryDoc, version)) {
    if (!isMap(op.node)) continue;
    addFromParams(op.doc, childAt(op.node, "parameters"), `${op.pointer}/parameters`);

    const rbNode = childAt(op.node, "requestBody");
    if (rbNode) {
      const resolved = resolveMaybeRef(graph, op.doc, rbNode, `${op.pointer}/requestBody`);
      if (isMap(resolved.node)) {
        addFromContent(resolved.doc, childAt(resolved.node, "content"), `${resolved.pointer}/content`);
      }
    }

    const responsesNode = childAt(op.node, "responses");
    if (isMap(responsesNode)) {
      for (const pair of responsesNode.items) {
        const status = keyToString(pair.key);
        if (!isNode(pair.value)) continue;
        const resolved = resolveMaybeRef(graph, op.doc, pair.value, `${op.pointer}/responses/${status}`);
        addFromResponse(resolved.doc, resolved.node, resolved.pointer);
      }
    }
  }

  return results;
}
