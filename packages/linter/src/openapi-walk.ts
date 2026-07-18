import { isMap, isNode, isSeq } from "yaml";
import type { Node, Pair } from "yaml";
import { resolveAlias } from "@oasis/core";
import type { OasisDocument, OpenApiVersion, WorkspaceGraph } from "@oasis/core";
import { childAt, isRefObject, keyToString, resolveMaybeRef } from "./util.ts";

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
  /** The document `keyNode` belongs to: always `entryDoc`, paired here so callers never have to
   *  reach for the outer `entryDoc` separately when attributing a diagnostic to the template key
   *  (which may live in a different file than the resolved path item body below). */
  keyDoc: OasisDocument;
  /** The (possibly $ref-resolved) document/node/pointer of the path item body. */
  doc: OasisDocument;
  node: Node;
  pointer: string;
}

/**
 * Per-graph memoization for the traversal helpers below. Many independent lint rules each call
 * `iteratePathItems`/`iterateOperations`/`iterateSchemas`/`iterateMediaTypes` once per lint run,
 * and every call re-walks the whole `paths`/`webhooks`/`components` tree from scratch. Since all
 * of these are pure functions of `(graph, entryDoc, documents, version)` and `entryDoc`/`documents`
 * are always derived consistently from `graph` by callers, results are cached per graph object
 * (a `WeakMap` so entries are dropped once a graph is no longer referenced, e.g. after an LSP
 * re-lint rebuilds the graph from an edited document).
 */
const walkCache = new WeakMap<WorkspaceGraph, Map<string, unknown>>();

function cached<T>(graph: WorkspaceGraph, key: string, compute: () => T): T {
  let perGraph = walkCache.get(graph);
  if (!perGraph) {
    perGraph = new Map();
    walkCache.set(graph, perGraph);
  }
  if (perGraph.has(key)) return perGraph.get(key) as T;
  const result = compute();
  perGraph.set(key, result);
  return result;
}

/**
 * Enumerate every entry of the entry document's top-level `paths` map, following a top-level $ref
 * if present. When `version` is "3.1", entries of the root `webhooks` map are included too (on
 * 3.0 documents `webhooks` is not a spec key; flagging it is left to structure rules).
 */
export function iteratePathItems(graph: WorkspaceGraph, entryDoc: OasisDocument, version?: OpenApiVersion): PathItemInfo[] {
  return cached(graph, `pathItems:${entryDoc.filePath}:${version}`, () => computeIteratePathItems(graph, entryDoc, version));
}

function computeIteratePathItems(graph: WorkspaceGraph, entryDoc: OasisDocument, version?: OpenApiVersion): PathItemInfo[] {
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
        keyDoc: entryDoc,
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
  return cached(graph, `operations:${entryDoc.filePath}:${version}`, () => computeIterateOperations(graph, entryDoc, version));
}

function computeIterateOperations(graph: WorkspaceGraph, entryDoc: OasisDocument, version?: OpenApiVersion): OperationInfo[] {
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

/**
 * Visit every entry of a `components/<section>` map, resolving each entry's `$ref` through the
 * workspace graph first. Shared by `computeIterateSchemas` and `computeIterateMediaTypes`, which
 * both walk the same set of components sections looking for different things.
 */
function eachComponentEntry(
  graph: WorkspaceGraph,
  doc: OasisDocument,
  components: Node,
  section: string,
  visit: (doc: OasisDocument, node: Node, pointer: string) => void,
): void {
  const sectionNode = childAt(components, section);
  if (!sectionNode || !isMap(sectionNode)) return;
  for (const pair of sectionNode.items) {
    const name = keyToString(pair.key);
    if (!isNode(pair.value)) continue;
    const resolved = resolveMaybeRef(graph, doc, pair.value, `/components/${section}/${name}`);
    visit(resolved.doc, resolved.node, resolved.pointer);
  }
}

export interface ParameterObjectInfo {
  doc: OasisDocument;
  node: Node;
  /** JSON Pointer of `node` within `doc` (its resolved definition site, not the referencing site). */
  pointer: string;
}

/**
 * Collect every parameter object reachable from path items, operations, and `components/parameters`,
 * deduplicated by resolved location so a parameter shared via `$ref` across several operations (or
 * also registered under `components/parameters`) is only checked once.
 */
export function collectParameterObjects(
  graph: WorkspaceGraph,
  entryDoc: OasisDocument,
  documents: OasisDocument[],
  version?: OpenApiVersion,
): ParameterObjectInfo[] {
  const seen = new Set<string>();
  const results: ParameterObjectInfo[] = [];

  function addFromArray(doc: OasisDocument, arrNode: Node | undefined, pointerPrefix: string): void {
    if (!arrNode || !isSeq(arrNode)) return;
    arrNode.items.forEach((item, i) => {
      if (!isNode(item)) return;
      const resolved = resolveMaybeRef(graph, doc, item, `${pointerPrefix}/${i}`);
      if (!isMap(resolved.node)) return;
      const key = `${resolved.doc.filePath}::${resolved.pointer}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ doc: resolved.doc, node: resolved.node, pointer: resolved.pointer });
    });
  }

  for (const pathItem of iteratePathItems(graph, entryDoc, version)) {
    if (!isMap(pathItem.node)) continue;
    addFromArray(pathItem.doc, childAt(pathItem.node, "parameters"), `${pathItem.pointer}/parameters`);
  }
  for (const op of iterateOperations(graph, entryDoc, version)) {
    if (!isMap(op.node)) continue;
    addFromArray(op.doc, childAt(op.node, "parameters"), `${op.pointer}/parameters`);
  }
  for (const doc of documents) {
    const root = doc.yamlDoc.contents;
    if (!root || !isMap(root)) continue;
    const componentsNode = childAt(root, "components");
    if (!componentsNode || !isMap(componentsNode)) continue;

    // Resolve through the workspace graph like every other components-level collector here
    // (`eachComponentEntry`), so a `components/parameters` entry that is itself a Reference
    // Object (same-document or cross-file) is validated at its resolved target rather than
    // skipped or checked against the bare `{ $ref: ... }` wrapper.
    eachComponentEntry(graph, doc, componentsNode, "parameters", (resolvedDoc, resolvedNode, pointer) => {
      if (!isMap(resolvedNode)) return;
      const key = `${resolvedDoc.filePath}::${pointer}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ doc: resolvedDoc, node: resolvedNode, pointer });
    });
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
  const key = `schemas:${entryDoc.filePath}:${documents.length}:${version}`;
  return cached(graph, key, () => computeIterateSchemas(graph, entryDoc, documents, version));
}

function computeIterateSchemas(
  graph: WorkspaceGraph,
  entryDoc: OasisDocument,
  documents: OasisDocument[],
  version?: OpenApiVersion,
): SchemaSite[] {
  const seen = new Set<string>();
  const results: SchemaSite[] = [];

  function addSchema(doc: OasisDocument, node: Node, pointer: string): void {
    // A Schema Object may carry keywords alongside `$ref`. In OpenAPI 3.1 (JSON Schema 2020-12)
    // those siblings are meaningful and must be validated; in 3.0 they're ignored per spec but
    // still worth flagging. Resolving the `$ref` away (below) would discard the referring node and
    // its siblings, so yield that node itself as its own site *in addition to* its resolved target.
    // `walkSchemaTree` never follows `$ref`, so the target isn't re-walked from here — it's visited
    // at its own definition site (deduped by file+pointer). The referring node's own file+pointer
    // can't collide with any resolved-target key, because a chain that reaches a `$ref` object keeps
    // resolving through it rather than stopping there.
    const aliased = resolveAlias(node) ?? node;
    if (isMap(aliased) && isRefObject(aliased) && aliased.items.some((p) => keyToString(p.key) !== "$ref")) {
      const refKey = `${doc.filePath}::${pointer}`;
      if (!seen.has(refKey)) {
        seen.add(refKey);
        results.push({ doc, node: aliased, pointer });
      }
    }

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
      if (!isNode(pair.value)) continue;
      const mediaTypeNode = resolveAlias(pair.value);
      if (!mediaTypeNode || !isMap(mediaTypeNode)) continue;
      const schema = childAt(mediaTypeNode, "schema");
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

    // `components/schemas` entries are passed to `addSchema` *raw* (not via `eachComponentEntry`,
    // which resolves the `$ref` first): a schema entry that is a Reference Object may carry sibling
    // keywords, and `addSchema` needs the referring node to preserve them (see its comment).
    const schemasNode = childAt(components, "schemas");
    if (isMap(schemasNode)) {
      for (const pair of schemasNode.items) {
        const name = keyToString(pair.key);
        if (isNode(pair.value)) addSchema(doc, pair.value, `/components/schemas/${name}`);
      }
    }
    eachComponentEntry(graph, doc, components, "parameters", addFromSchemaBearing);
    eachComponentEntry(graph, doc, components, "headers", addFromSchemaBearing);
    eachComponentEntry(graph, doc, components, "requestBodies", (d, n, p) => {
      if (isMap(n)) addFromContent(d, childAt(n, "content"), `${p}/content`);
    });
    eachComponentEntry(graph, doc, components, "responses", addFromResponse);
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

/** A site where a Media Type Object appears: the (possibly $ref-resolved) media type root node. */
export interface MediaTypeSite {
  doc: OasisDocument;
  /** The resolved Media Type Object node (always a YAML map). */
  node: Node;
  pointer: string;
}

/**
 * Enumerate every Media Type Object under a `content` map: request bodies (operation-level and
 * `components/requestBodies`) and responses (operation-level and `components/responses`), on
 * `paths` and, on 3.1, `webhooks`. `$ref`s to request bodies / responses / media types are
 * resolved through the workspace graph; each resolved site is yielded once, deduplicated by
 * file + pointer.
 */
export function iterateMediaTypes(
  graph: WorkspaceGraph,
  entryDoc: OasisDocument,
  documents: OasisDocument[],
  version?: OpenApiVersion,
): MediaTypeSite[] {
  const key = `mediaTypes:${entryDoc.filePath}:${documents.length}:${version}`;
  return cached(graph, key, () => computeIterateMediaTypes(graph, entryDoc, documents, version));
}

function computeIterateMediaTypes(
  graph: WorkspaceGraph,
  entryDoc: OasisDocument,
  documents: OasisDocument[],
  version?: OpenApiVersion,
): MediaTypeSite[] {
  const seen = new Set<string>();
  const results: MediaTypeSite[] = [];

  function addFromContent(doc: OasisDocument, contentNode: Node | undefined, pointer: string): void {
    if (!contentNode || !isMap(contentNode)) return;
    for (const pair of contentNode.items) {
      const mediaType = keyToString(pair.key);
      if (!isNode(pair.value)) continue;
      const resolved = resolveMaybeRef(graph, doc, pair.value, `${pointer}/${mediaType}`);
      if (!isMap(resolved.node)) continue;
      const key = `${resolved.doc.filePath}::${resolved.pointer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ doc: resolved.doc, node: resolved.node, pointer: resolved.pointer });
    }
  }

  for (const doc of documents) {
    const root = doc.yamlDoc.contents;
    if (!root || !isMap(root)) continue;
    const components = childAt(root, "components");
    if (!components || !isMap(components)) continue;

    eachComponentEntry(graph, doc, components, "requestBodies", (d, n, p) => {
      if (isMap(n)) addFromContent(d, childAt(n, "content"), `${p}/content`);
    });
    eachComponentEntry(graph, doc, components, "responses", (d, n, p) => {
      if (isMap(n)) addFromContent(d, childAt(n, "content"), `${p}/content`);
    });
  }

  for (const op of iterateOperations(graph, entryDoc, version)) {
    if (!isMap(op.node)) continue;

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
        if (isMap(resolved.node)) {
          addFromContent(resolved.doc, childAt(resolved.node, "content"), `${resolved.pointer}/content`);
        }
      }
    }
  }

  return results;
}

/**
 * JSON Schema applicator keywords whose value is a *single* nested Schema Object.
 * `items`/`additionalProperties`/`not` exist in both dialects; the rest are JSON Schema 2020-12
 * (OpenAPI 3.1) only.
 */
const SINGLE_SCHEMA_KEYS_COMMON = ["items", "additionalProperties", "not"] as const;
const SINGLE_SCHEMA_KEYS_31 = [
  "if",
  "then",
  "else",
  "propertyNames",
  "contains",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contentSchema",
] as const;

/** Applicator keywords whose value is a *map* of named Schema Objects (name/pattern -> schema). */
const MAP_OF_SCHEMAS_KEYS_COMMON = ["properties"] as const;
const MAP_OF_SCHEMAS_KEYS_31 = ["patternProperties", "$defs", "dependentSchemas"] as const;

/** Applicator keywords whose value is a *sequence* of Schema Objects. */
const SEQ_OF_SCHEMAS_KEYS_COMMON = ["allOf", "oneOf", "anyOf"] as const;
const SEQ_OF_SCHEMAS_KEYS_31 = ["prefixItems"] as const;

/**
 * Recursively visit every nested Schema Object reachable from `node` through the JSON Schema
 * applicators legal in the document's `version`. Traversal is complete and version-aware:
 * - 3.0: `properties`, `items`, `additionalProperties`, `allOf`/`oneOf`/`anyOf`, `not`.
 * - 3.1 (JSON Schema 2020-12): all of the above plus `patternProperties`, `prefixItems`,
 *   `if`/`then`/`else`, `contains`, `propertyNames`, `dependentSchemas`, `$defs`,
 *   `unevaluatedItems`, `unevaluatedProperties`, `contentSchema`.
 * When `version` is `undefined` the 3.1 applicators are included too, so nothing is missed on a
 * document whose version couldn't be detected.
 *
 * `$ref`s are not followed for discovery — a `$ref`'d schema is visited at its own definition site
 * (`components/schemas` etc., via `iterateSchemas`) — and `seen` guards against revisiting a node
 * reached more than once (e.g. shared inline schemas, or when a caller shares one `seen` set across
 * multiple root calls).
 */
export function walkSchemaTree(
  node: Node,
  visit: (schema: Node) => void,
  version: OpenApiVersion | undefined,
  seen: Set<Node> = new Set(),
): void {
  const resolved = resolveAlias(node);
  if (!resolved || !isMap(resolved) || seen.has(resolved)) return;
  seen.add(resolved);
  visit(resolved);

  const include31 = version !== "3.0";
  const singleKeys = include31 ? [...SINGLE_SCHEMA_KEYS_COMMON, ...SINGLE_SCHEMA_KEYS_31] : SINGLE_SCHEMA_KEYS_COMMON;
  const mapKeys = include31 ? [...MAP_OF_SCHEMAS_KEYS_COMMON, ...MAP_OF_SCHEMAS_KEYS_31] : MAP_OF_SCHEMAS_KEYS_COMMON;
  const seqKeys = include31 ? [...SEQ_OF_SCHEMAS_KEYS_COMMON, ...SEQ_OF_SCHEMAS_KEYS_31] : SEQ_OF_SCHEMAS_KEYS_COMMON;

  for (const key of singleKeys) {
    const child = childAt(resolved, key);
    if (isNode(child)) walkSchemaTree(child, visit, version, seen);
  }

  for (const key of mapKeys) {
    const map = childAt(resolved, key);
    if (isMap(map)) {
      for (const pair of map.items) {
        if (isNode(pair.value)) walkSchemaTree(pair.value, visit, version, seen);
      }
    }
  }

  for (const key of seqKeys) {
    const seq = childAt(resolved, key);
    if (isSeq(seq)) {
      for (const item of seq.items) {
        if (isNode(item)) walkSchemaTree(item, visit, version, seen);
      }
    }
  }
}
