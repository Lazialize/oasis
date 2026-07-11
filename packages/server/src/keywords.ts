import { isMap } from "yaml";
import { parsePointer } from "@oasis/core";
import type { OasisDocument, OpenApiVersion } from "@oasis/core";
import { mapKeys } from "./yaml-helpers.ts";

/**
 * The declarative set of "object kinds" the completion/hover logic understands. Deliberately not
 * spec-complete — covers the common objects well, and is easy to extend by adding a case to
 * `classifyPointer` plus an entry in `KEY_TABLE`.
 */
export type ObjectKind =
  | "root"
  | "info"
  | "pathItem"
  | "operation"
  | "parameter"
  | "requestBody"
  | "responses"
  | "response"
  | "mediaType"
  | "schema"
  | "components"
  | "securityScheme";

/** Component section name (under `components/<section>/<name>`) an object kind lives in, when applicable. */
export const KIND_TO_COMPONENT_SECTION: Partial<Record<ObjectKind, string>> = {
  schema: "schemas",
  parameter: "parameters",
  requestBody: "requestBodies",
  response: "responses",
  securityScheme: "securitySchemes",
};

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

const BASE_KEYS: Record<ObjectKind, string[]> = {
  root: ["openapi", "info", "servers", "paths", "components", "security", "tags", "externalDocs"],
  info: ["title", "description", "termsOfService", "contact", "license", "version", "summary"],
  pathItem: ["summary", "description", "servers", "parameters", "$ref", ...HTTP_METHODS],
  operation: [
    "tags",
    "summary",
    "description",
    "externalDocs",
    "operationId",
    "parameters",
    "requestBody",
    "responses",
    "callbacks",
    "deprecated",
    "security",
    "servers",
  ],
  parameter: [
    "name",
    "in",
    "description",
    "required",
    "deprecated",
    "allowEmptyValue",
    "style",
    "explode",
    "allowReserved",
    "schema",
    "example",
    "examples",
    "content",
    "$ref",
  ],
  requestBody: ["description", "content", "required", "$ref"],
  responses: ["default"],
  response: ["description", "headers", "content", "links", "$ref"],
  mediaType: ["schema", "example", "examples", "encoding"],
  schema: [
    "title",
    "description",
    "type",
    "format",
    "default",
    "enum",
    "multipleOf",
    "maximum",
    "exclusiveMaximum",
    "minimum",
    "exclusiveMinimum",
    "maxLength",
    "minLength",
    "pattern",
    "items",
    "maxItems",
    "minItems",
    "uniqueItems",
    "maxProperties",
    "minProperties",
    "required",
    "properties",
    "additionalProperties",
    "allOf",
    "oneOf",
    "anyOf",
    "not",
    "$ref",
    "readOnly",
    "writeOnly",
    "xml",
    "externalDocs",
    "example",
    "deprecated",
  ],
  components: [
    "schemas",
    "responses",
    "parameters",
    "examples",
    "requestBodies",
    "headers",
    "securitySchemes",
    "links",
    "callbacks",
  ],
  securityScheme: ["type", "description", "name", "in", "scheme", "bearerFormat", "flows", "openIdConnectUrl"],
};

/** Version-specific additions/removals layered on top of `BASE_KEYS`. */
function versionDelta(kind: ObjectKind, version: OpenApiVersion): { add: string[]; remove: string[] } {
  if (kind === "schema") {
    if (version === "3.0") return { add: ["nullable"], remove: [] };
    return {
      add: ["const", "examples", "$id", "$schema", "$anchor", "prefixItems", "if", "then", "else", "contentMediaType", "contentEncoding", "patternProperties", "propertyNames"],
      remove: ["nullable"],
    };
  }
  if (kind === "root" && version === "3.1") {
    return { add: ["webhooks", "jsonSchemaDialect"], remove: [] };
  }
  if (kind === "components" && version === "3.1") {
    return { add: ["pathItems"], remove: [] };
  }
  return { add: [], remove: [] };
}

/** All keys valid on an object of the given kind, for the given OpenAPI version. */
export function allowedKeys(kind: ObjectKind, version: OpenApiVersion): string[] {
  const base = BASE_KEYS[kind];
  const { add, remove } = versionDelta(kind, version);
  const removeSet = new Set(remove);
  return [...base.filter((k) => !removeSet.has(k)), ...add];
}

/**
 * Heuristic root object kind for `doc`, for pointer classification: a full OpenAPI document
 * (`"root"`) declares an `openapi` key; a Path Item fragment file (`paths: { /pets: { $ref:
 * './pets.yaml' } }`) doesn't, and its own top-level map contains HTTP method keys directly.
 * Anything else defaults to `"root"`, matching pre-project-mode behavior.
 */
export function inferRootKind(doc: OasisDocument): ObjectKind {
  const root = doc.yamlDoc.contents;
  const keys = mapKeys(isMap(root) ? root : undefined);
  if (keys.includes("openapi")) return "root";
  if (keys.some((k) => HTTP_METHODS.includes(k))) return "pathItem";
  return "root";
}

type WalkState = ObjectKind | "paths" | "parameterList" | "contentMap" | "responsesMap" | "headerMap" | "schemaPropMap" | "schemaList" | "componentSchemaMap" | "componentParameterMap" | "componentRequestBodyMap" | "componentResponseMap" | "componentSecuritySchemeMap" | "unknown";

/**
 * Classify the object kind that lives at `pointer`, by walking the JSON Pointer segments from
 * `rootKind` (the kind of object the document itself is rooted at) through a small state machine
 * mirroring the OpenAPI object model. `rootKind` defaults to `"root"` (a full OpenAPI document);
 * pass `"pathItem"` for a Path Item fragment file (e.g. `paths: { /pets: { $ref: './pets.yaml' }
 * }`), whose own document root *is* a path item rather than the full document.
 */
export function classifyPointer(pointer: string, rootKind: ObjectKind = "root"): ObjectKind | undefined {
  const segments = parsePointer(pointer);
  let state: WalkState = rootKind;

  for (const seg of segments) {
    state = step(state, seg);
  }

  return isObjectKind(state) ? state : undefined;
}

function isObjectKind(state: WalkState): state is ObjectKind {
  return (
    state === "root" ||
    state === "info" ||
    state === "pathItem" ||
    state === "operation" ||
    state === "parameter" ||
    state === "requestBody" ||
    state === "responses" ||
    state === "response" ||
    state === "mediaType" ||
    state === "schema" ||
    state === "components" ||
    state === "securityScheme"
  );
}

function step(state: WalkState, seg: string): WalkState {
  switch (state) {
    case "root":
      if (seg === "info") return "info";
      if (seg === "paths") return "paths";
      if (seg === "components") return "components";
      return "unknown";
    case "paths":
      return "pathItem";
    case "pathItem":
      if (HTTP_METHODS.includes(seg)) return "operation";
      if (seg === "parameters") return "parameterList";
      return "unknown";
    case "parameterList":
      return /^\d+$/.test(seg) ? "parameter" : "unknown";
    case "operation":
      if (seg === "parameters") return "parameterList";
      if (seg === "requestBody") return "requestBody";
      if (seg === "responses") return "responses";
      return "unknown";
    case "requestBody":
      if (seg === "content") return "contentMap";
      return "unknown";
    case "contentMap":
      return "mediaType";
    case "mediaType":
      if (seg === "schema") return "schema";
      return "unknown";
    case "responses":
      return "response";
    case "response":
      if (seg === "content") return "contentMap";
      if (seg === "headers") return "headerMap";
      return "unknown";
    case "headerMap":
      return "unknown"; // headers not modeled in detail yet
    case "schema":
      if (seg === "properties") return "schemaPropMap";
      if (seg === "items" || seg === "additionalProperties" || seg === "not") return "schema";
      if (seg === "allOf" || seg === "oneOf" || seg === "anyOf") return "schemaList";
      return "unknown";
    case "schemaPropMap":
      return "schema";
    case "schemaList":
      return /^\d+$/.test(seg) ? "schema" : "unknown";
    case "components":
      if (seg === "schemas") return "componentSchemaMap";
      if (seg === "parameters") return "componentParameterMap";
      if (seg === "requestBodies") return "componentRequestBodyMap";
      if (seg === "responses") return "componentResponseMap";
      if (seg === "securitySchemes") return "componentSecuritySchemeMap";
      return "unknown";
    case "componentSchemaMap":
      return "schema";
    case "componentParameterMap":
      return "parameter";
    case "componentRequestBodyMap":
      return "requestBody";
    case "componentResponseMap":
      return "response";
    case "componentSecuritySchemeMap":
      return "securityScheme";
    default:
      return "unknown";
  }
}
