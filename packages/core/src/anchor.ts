import { pathToFileURL } from "node:url";
import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node, Scalar } from "yaml";
import type { OasisDocument } from "./parse.ts";
import { safeDecodeURIComponent } from "./pointer.ts";
import { rangeFromOffsets, zeroRange } from "./position.ts";
import type { Range } from "./types.ts";
import { resolveUriReference, stripUriFragment } from "./uri.ts";
import { detectVersion } from "./version.ts";
import { resolveAlias } from "./walk.ts";

export interface SchemaResourceEntry {
  uri: string;
  node: Node;
  range: Range;
  /** Base active immediately before this resource root applies its own `$id`. */
  parentBaseUri: string;
}
export interface AnchorEntry {
  name: string;
  node: Node;
  range: Range;
  dynamic: boolean;
  /** Raw nearest `$id`, retained for compatibility. */
  scope: string;
  resourceUri: string;
}
export interface AnchorIndex {
  byName: Map<string, AnchorEntry>;
  byResource: Map<string, Map<string, AnchorEntry>>;
  resources: Map<string, SchemaResourceEntry>;
  /** Effective resource bases observed for each schema node (aliases may contribute several). */
  baseUrisByNode: Map<Node, Set<string>>;
  entries: AnchorEntry[];
}
export interface AnchorIndexOptions { baseUri?: string; schemaDocument?: boolean }

const cacheByDocument = new WeakMap<OasisDocument, Map<string, AnchorIndex>>();
const SINGLE_SCHEMA_KEYS = new Set([
  "items", "additionalProperties", "not", "if", "then", "else", "propertyNames", "contains",
  "unevaluatedItems", "unevaluatedProperties", "contentSchema",
]);
const MAP_SCHEMA_KEYS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const SEQUENCE_SCHEMA_KEYS = new Set(["allOf", "oneOf", "anyOf", "prefixItems"]);
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

type ObjectKind = "root" | "components" | "paths-map" | "webhooks-map" | "path-item" | "operation" |
  "parameter" | "header" | "request-body" | "response" | "media-type" | "encoding" | "callback" | "schema";

function scalarString(node: unknown): string | undefined {
  return isScalar(node) && typeof (node as Scalar).value === "string" ? String((node as Scalar).value) : undefined;
}

/** Build an index from actual 3.1 Schema Object contexts, never from lookalike OpenAPI/extension data. */
export function buildAnchorIndex(doc: OasisDocument, options: AnchorIndexOptions = {}): AnchorIndex {
  const baseUri = stripUriFragment(options.baseUri ?? pathToFileURL(doc.filePath).href);
  const schemaDocument = options.schemaDocument ?? false;
  const cacheKey = `${baseUri}\u0000${schemaDocument}`;
  const docCache = cacheByDocument.get(doc);
  const cached = docCache?.get(cacheKey);
  if (cached) return cached;
  const index: AnchorIndex = {
    byName: new Map(),
    byResource: new Map(),
    resources: new Map(),
    baseUrisByNode: new Map(),
    entries: [],
  };
  const root = doc.yamlDoc.contents;

  function rangeOf(node: Node): Range {
    return node.range ? rangeFromOffsets(doc.filePath, doc.lineCounter, node.range[0], node.range[1]) : zeroRange(doc.filePath);
  }
  function resource(uri: string, node: Node, parentBaseUri: string): void {
    if (!index.resources.has(uri)) {
      index.resources.set(uri, { uri, node, range: rangeOf(node), parentBaseUri: stripUriFragment(parentBaseUri) });
    }
  }
  function anchor(name: string, node: Node, dynamic: boolean, scope: string, resourceUri: string): void {
    const entry: AnchorEntry = { name, node, range: rangeOf(node), dynamic, scope, resourceUri };
    index.entries.push(entry);
    if (!index.byName.has(name)) index.byName.set(name, entry);
    let scoped = index.byResource.get(resourceUri);
    if (!scoped) { scoped = new Map(); index.byResource.set(resourceUri, scoped); }
    if (!scoped.has(name)) scoped.set(name, entry);
  }

  const schemaSeen = new Map<string, Set<Node>>();
  function walkSchema(node: Node, currentBase: string, resourceUri: string, rawScope: string): void {
    const resolved = resolveAlias(node, doc.yamlDoc);
    if (!resolved) return;
    let nodeBase = currentBase;
    let nodeResource = resourceUri;
    let nodeScope = rawScope;
    if (isMap(resolved)) {
      const id = scalarString(resolved.items.find((pair) => scalarString(pair.key) === "$id")?.value);
      if (id !== undefined) {
        nodeBase = resolveUriReference(currentBase, id);
        nodeResource = stripUriFragment(nodeBase);
        nodeScope = id;
        resource(nodeResource, resolved, currentBase);
      }
    }
    const bases = index.baseUrisByNode.get(resolved) ?? new Set<string>();
    bases.add(stripUriFragment(nodeBase));
    index.baseUrisByNode.set(resolved, bases);
    const context = `${nodeBase}\u0000${nodeResource}`;
    let seen = schemaSeen.get(context);
    if (!seen) { seen = new Set(); schemaSeen.set(context, seen); }
    if (seen.has(resolved)) return;
    seen.add(resolved);
    if (!isMap(resolved)) return;

    for (const pair of resolved.items) {
      const key = scalarString(pair.key);
      if ((key === "$anchor" || key === "$dynamicAnchor")) {
        const name = scalarString(pair.value);
        if (name !== undefined) anchor(name, resolved, key === "$dynamicAnchor", nodeScope, nodeResource);
      }
      if (!key || !isNode(pair.value)) continue;
      if (SINGLE_SCHEMA_KEYS.has(key)) walkSchema(pair.value, nodeBase, nodeResource, nodeScope);
      else if (MAP_SCHEMA_KEYS.has(key)) {
        const map = resolveAlias(pair.value, doc.yamlDoc);
        if (map && isMap(map)) for (const entry of map.items) if (isNode(entry.value)) walkSchema(entry.value, nodeBase, nodeResource, nodeScope);
      } else if (SEQUENCE_SCHEMA_KEYS.has(key)) {
        const seq = resolveAlias(pair.value, doc.yamlDoc);
        if (seq && isSeq(seq)) for (const item of seq.items) if (isNode(item)) walkSchema(item, nodeBase, nodeResource, nodeScope);
      }
    }
  }

  function entryKind(parent: ObjectKind | undefined, key: string): ObjectKind | undefined {
    if (parent === "root" && key === "paths") return "paths-map";
    if (parent === "root" && key === "webhooks") return "webhooks-map";
    if (parent === "components") {
      if (key === "schemas") return "schema";
      if (key === "parameters") return "parameter";
      if (key === "headers") return "header";
      if (key === "requestBodies") return "request-body";
      if (key === "responses") return "response";
      if (key === "pathItems") return "path-item";
      if (key === "callbacks") return "callback";
    }
    if ((parent === "path-item" || parent === "operation") && key === "parameters") return "parameter";
    if (parent === "operation" && key === "responses") return "response";
    if (parent === "operation" && key === "callbacks") return "callback";
    if (parent === "response" && key === "headers") return "header";
    if (parent === "media-type" && key === "encoding") return "encoding";
    if (parent === "encoding" && key === "headers") return "header";
    if (["parameter", "header", "request-body", "response"].includes(parent ?? "") && key === "content") return "media-type";
    return undefined;
  }
  function directKind(parent: ObjectKind | undefined, key: string): ObjectKind | undefined {
    if (parent === "root" && key === "components") return "components";
    if (parent === "path-item" && HTTP_METHODS.has(key)) return "operation";
    if (parent === "operation" && key === "requestBody") return "request-body";
    if (["parameter", "header", "media-type"].includes(parent ?? "") && key === "schema") return "schema";
    if (parent === "callback" && !key.startsWith("x-")) return "path-item";
    return undefined;
  }
  const openApiSeen = new Map<string, Set<Node>>();
  function scanOpenApi(node: Node, kind: ObjectKind | undefined, containerKind?: ObjectKind): void {
    const resolved = resolveAlias(node, doc.yamlDoc);
    if (!resolved) return;
    if (kind === "schema") { walkSchema(resolved, baseUri, baseUri, ""); return; }
    const context = `${kind}\u0000${containerKind}`;
    let seen = openApiSeen.get(context);
    if (!seen) { seen = new Set(); openApiSeen.set(context, seen); }
    if (seen.has(resolved)) return;
    seen.add(resolved);
    if (isMap(resolved)) {
      for (const pair of resolved.items) {
        const key = scalarString(pair.key);
        if (!key || !isNode(pair.value)) continue;
        if (containerKind === "paths-map" && key.startsWith("x-")) continue;
        const nextKind = containerKind
          ? containerKind === "paths-map" || containerKind === "webhooks-map" ? "path-item" : containerKind
          : directKind(kind, key);
        const nextContainer = containerKind ? undefined : entryKind(kind, key);
        scanOpenApi(pair.value, nextKind, nextContainer);
      }
    } else if (isSeq(resolved)) {
      for (const item of resolved.items) {
        if (isNode(item)) scanOpenApi(item, containerKind ?? kind);
      }
    }
  }

  if (isNode(root) && (schemaDocument || detectVersion(doc) === "3.1")) {
    resource(baseUri, root, baseUri);
    if (schemaDocument) walkSchema(root, baseUri, baseUri, "");
    else scanOpenApi(root, "root");
  }
  const nextCache = docCache ?? new Map<string, AnchorIndex>();
  nextCache.set(cacheKey, index);
  if (!docCache) cacheByDocument.set(doc, nextCache);
  return index;
}

export function resolveAnchor(doc: OasisDocument, fragment: string, resourceUri?: string, index?: AnchorIndex): AnchorEntry | undefined {
  const name = safeDecodeURIComponent(fragment);
  const anchors = index ?? buildAnchorIndex(doc);
  return resourceUri ? anchors.byResource.get(stripUriFragment(resourceUri))?.get(name) : anchors.byName.get(name);
}
