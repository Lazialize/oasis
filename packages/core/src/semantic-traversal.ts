/**
 * The single authoritative, version-aware model of OpenAPI object edges and JSON Schema applicator
 * keys. Reference discovery (`findRefs` in `ref.ts`) and anchor/resource indexing
 * (`buildAnchorIndex` in `anchor.ts`) each walk the same semantic tree for different payloads;
 * keeping the transition tables here means a new Schema applicator or OpenAPI object position is
 * added once and both walkers see it. Consumers still own their traversal, caches, and outputs —
 * this module only classifies edges, it never reads or resolves nodes.
 */

/** The semantic kind of an OpenAPI (or embedded JSON Schema) object reached during traversal. */
export type OpenApiObjectKind =
  | "root"
  | "components"
  | "paths-map"
  | "webhooks-map"
  | "path-item"
  | "operation"
  | "parameter"
  | "header"
  | "request-body"
  | "response"
  | "media-type"
  | "encoding"
  | "callback"
  | "example"
  | "link"
  | "security-scheme"
  | "schema";

/** HTTP method keys that introduce an Operation Object under a Path Item Object. */
export const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace", "query"]);

/** JSON Schema 2020-12 applicator keywords whose value is a single subschema. */
export const SINGLE_SCHEMA_KEYS = new Set([
  "items",
  "additionalProperties",
  "not",
  "if",
  "then",
  "else",
  "propertyNames",
  "contains",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contentSchema",
]);

/** JSON Schema 2020-12 applicator keywords whose value is a map of named subschemas. */
export const MAP_SCHEMA_KEYS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);

/** JSON Schema 2020-12 applicator keywords whose value is a sequence of subschemas. */
export const SEQUENCE_SCHEMA_KEYS = new Set(["allOf", "oneOf", "anyOf", "prefixItems"]);

/**
 * The semantic kind of a direct (single-object) child of `parentKind` reached under `key`, or
 * `undefined` when the child is not a schema-bearing OpenAPI object position. `components` is the
 * only edge valid in OpenAPI 3.0; every deeper object edge (and the JSON Schema applicators) only
 * exists once 2020-12 Schema Object semantics apply, so those are gated by `schema31`.
 */
export function directObjectKind(
  parentKind: OpenApiObjectKind | undefined,
  key: string | undefined,
  schema31: boolean,
): OpenApiObjectKind | undefined {
  if (parentKind === "root" && key === "components") return "components";
  if (!schema31 || key === undefined) return undefined;
  if (parentKind === "path-item" && HTTP_METHODS.has(key)) return "operation";
  if (parentKind === "operation" && key === "requestBody") return "request-body";
  if ((parentKind === "parameter" || parentKind === "header" || parentKind === "media-type") &&
    (key === "schema" || key === "itemSchema")) {
    return "schema";
  }
  if ((parentKind === "media-type" || parentKind === "encoding") && key === "itemEncoding") return "encoding";
  if (parentKind === "callback" && !key.startsWith("x-")) return "path-item";
  if (parentKind === "schema" && (SINGLE_SCHEMA_KEYS.has(key) || SEQUENCE_SCHEMA_KEYS.has(key))) return "schema";
  return undefined;
}

/**
 * The semantic kind shared by the *entries* of a named-entry container reached under `key` from
 * `parentKind`, or `undefined` when `key` is not a container position at this parent. `examples`
 * (map form) and `links` carry Example/Link Objects in both 3.0 and 3.1, so they are ungated; every
 * other container edge, and the `$defs`/`properties`/... Schema-Object maps, require 2020-12
 * semantics and are gated by `schema31`. The value's shape (map vs sequence) is the caller's
 * concern — a sequence-form `examples` is literal data, not an Example Object map.
 */
export function containerEntryKind(
  parentKind: OpenApiObjectKind | undefined,
  key: string,
  schema31: boolean,
): OpenApiObjectKind | undefined {
  if (key === "examples") return "example";
  if (key === "links") return "link";
  if (!schema31) return undefined;
  if (parentKind === "root" && key === "paths") return "paths-map";
  if (parentKind === "root" && key === "webhooks") return "webhooks-map";
  if (parentKind === "components") {
    if (key === "schemas") return "schema";
    if (key === "parameters") return "parameter";
    if (key === "headers") return "header";
    if (key === "requestBodies") return "request-body";
    if (key === "responses") return "response";
    if (key === "pathItems") return "path-item";
    if (key === "callbacks") return "callback";
    if (key === "mediaTypes") return "media-type";
    if (key === "securitySchemes") return "security-scheme";
  }
  if (parentKind === "path-item" && key === "additionalOperations") return "operation";
  if ((parentKind === "path-item" || parentKind === "operation") && key === "parameters") return "parameter";
  if (parentKind === "operation" && key === "responses") return "response";
  if (parentKind === "operation" && key === "callbacks") return "callback";
  if (parentKind === "response" && key === "headers") return "header";
  if (parentKind === "media-type" && key === "encoding") return "encoding";
  if ((parentKind === "media-type" || parentKind === "encoding") && key === "prefixEncoding") return "encoding";
  if (parentKind === "encoding" && key === "encoding") return "encoding";
  if (parentKind === "encoding" && key === "headers") return "header";
  if (
    (parentKind === "parameter" ||
      parentKind === "header" ||
      parentKind === "request-body" ||
      parentKind === "response") &&
    key === "content"
  ) {
    return "media-type";
  }
  if (parentKind === "schema" && MAP_SCHEMA_KEYS.has(key)) return "schema";
  return undefined;
}
