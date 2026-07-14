import { isMap } from "yaml";
import { parsePointer } from "@oasis/core";
import type { OasisDocument, OpenApiVersion } from "@oasis/core";
import { allowedFieldNames } from "@oasis/linter";
import type { ObjectKind } from "@oasis/linter";
import { mapKeys } from "./yaml-helpers.ts";

/**
 * The "object kinds" the completion/hover logic understands. Re-exported from the linter's shared,
 * version-aware object-shape table (`@oasis/linter`) so the keys the editor suggests at a cursor and
 * the keys the linter validates come from a single source and never drift (issues #60, #65).
 */
export type { ObjectKind } from "@oasis/linter";

/** Component section name (under `components/<section>/<name>`) an object kind lives in, when applicable. */
export const KIND_TO_COMPONENT_SECTION: Partial<Record<ObjectKind, string>> = {
  schema: "schemas",
  parameter: "parameters",
  requestBody: "requestBodies",
  response: "responses",
  securityScheme: "securitySchemes",
  header: "headers",
  example: "examples",
  link: "links",
  callback: "callbacks",
  pathItem: "pathItems",
};

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/** All keys valid on an object of the given kind, for the given OpenAPI version. */
export function allowedKeys(kind: ObjectKind, version: OpenApiVersion): string[] {
  return allowedFieldNames(kind, version);
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

/** Intermediate (non-object-kind) states the pointer walk passes through. */
type IntermediateState =
  | "paths"
  | "webhooksMap"
  | "parameterList"
  | "serverList"
  | "tagList"
  | "contentMap"
  | "headerMap"
  | "linkMap"
  | "exampleMap"
  | "encodingMap"
  | "callbackMap"
  | "schemaPropMap"
  | "schemaList"
  | "serverVariableMap"
  | "componentSchemaMap"
  | "componentParameterMap"
  | "componentRequestBodyMap"
  | "componentResponseMap"
  | "componentSecuritySchemeMap"
  | "componentHeaderMap"
  | "componentExampleMap"
  | "componentLinkMap"
  | "componentCallbackMap"
  | "componentPathItemMap"
  | "unknown";

type WalkState = ObjectKind | IntermediateState;

const OBJECT_KINDS: ReadonlySet<string> = new Set<ObjectKind>([
  "root",
  "info",
  "contact",
  "license",
  "server",
  "serverVariable",
  "externalDocs",
  "tag",
  "pathItem",
  "operation",
  "parameter",
  "header",
  "requestBody",
  "responses",
  "response",
  "mediaType",
  "encoding",
  "example",
  "link",
  "callback",
  "schema",
  "components",
  "securityScheme",
  "oauthFlows",
  "oauthFlow",
]);

/** JSON Schema keywords whose value is a single nested Schema Object. */
const SCHEMA_SINGLE = new Set([
  "items",
  "additionalProperties",
  "not",
  "propertyNames",
  "contains",
  "if",
  "then",
  "else",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contentSchema",
]);
/** JSON Schema keywords whose value is a sequence of Schema Objects. */
const SCHEMA_SEQ = new Set(["allOf", "oneOf", "anyOf", "prefixItems"]);
/** JSON Schema keywords whose value is a map of named Schema Objects. */
const SCHEMA_MAP = new Set(["properties", "patternProperties", "$defs", "dependentSchemas"]);

/**
 * Classify the object kind that lives at `pointer`, by walking the JSON Pointer segments from
 * `rootKind` (the kind of object the document itself is rooted at) through a state machine mirroring
 * the OpenAPI object model. `rootKind` defaults to `"root"` (a full OpenAPI document); pass
 * `"pathItem"` for a Path Item fragment file whose own document root *is* a path item.
 */
export function classifyPointer(pointer: string, rootKind: ObjectKind = "root"): ObjectKind | undefined {
  let state: WalkState = rootKind;
  for (const seg of parsePointer(pointer)) {
    state = step(state, seg);
    if (state === "unknown") return undefined;
  }
  return OBJECT_KINDS.has(state) ? (state as ObjectKind) : undefined;
}

function isIndex(seg: string): boolean {
  return /^\d+$/.test(seg);
}

function step(state: WalkState, seg: string): WalkState {
  switch (state) {
    case "root":
      if (seg === "info") return "info";
      if (seg === "paths") return "paths";
      if (seg === "webhooks") return "webhooksMap";
      if (seg === "components") return "components";
      if (seg === "servers") return "serverList";
      if (seg === "tags") return "tagList";
      if (seg === "externalDocs") return "externalDocs";
      return "unknown";
    case "info":
      if (seg === "contact") return "contact";
      if (seg === "license") return "license";
      return "unknown";
    case "tag":
      if (seg === "externalDocs") return "externalDocs";
      return "unknown";
    case "server":
      if (seg === "variables") return "serverVariableMap";
      return "unknown";
    case "serverVariableMap":
      return "serverVariable";
    case "tagList":
      return isIndex(seg) ? "tag" : "unknown";
    case "serverList":
      return isIndex(seg) ? "server" : "unknown";
    case "paths":
      return "pathItem";
    case "webhooksMap":
      return "pathItem";
    case "pathItem":
      if (HTTP_METHODS.includes(seg)) return "operation";
      if (seg === "parameters") return "parameterList";
      if (seg === "servers") return "serverList";
      return "unknown";
    case "parameterList":
      return isIndex(seg) ? "parameter" : "unknown";
    case "operation":
      if (seg === "parameters") return "parameterList";
      if (seg === "requestBody") return "requestBody";
      if (seg === "responses") return "responses";
      if (seg === "callbacks") return "callbackMap";
      if (seg === "servers") return "serverList";
      if (seg === "externalDocs") return "externalDocs";
      return "unknown";
    case "parameter":
    case "header":
      if (seg === "schema") return "schema";
      if (seg === "content") return "contentMap";
      if (seg === "examples") return "exampleMap";
      return "unknown";
    case "requestBody":
      if (seg === "content") return "contentMap";
      return "unknown";
    case "contentMap":
      return "mediaType";
    case "mediaType":
      if (seg === "schema") return "schema";
      if (seg === "examples") return "exampleMap";
      if (seg === "encoding") return "encodingMap";
      return "unknown";
    case "encodingMap":
      return "encoding";
    case "encoding":
      if (seg === "headers") return "headerMap";
      return "unknown";
    case "exampleMap":
      return "example";
    case "responses":
      return "response";
    case "response":
      if (seg === "content") return "contentMap";
      if (seg === "headers") return "headerMap";
      if (seg === "links") return "linkMap";
      return "unknown";
    case "headerMap":
      return "header";
    case "linkMap":
      return "link";
    case "link":
      if (seg === "server") return "server";
      return "unknown";
    case "callbackMap":
      return "callback";
    case "callback":
      return "pathItem"; // keys are runtime expressions -> Path Item Objects
    case "schema":
      if (SCHEMA_MAP.has(seg)) return "schemaPropMap";
      if (SCHEMA_SINGLE.has(seg)) return "schema";
      if (SCHEMA_SEQ.has(seg)) return "schemaList";
      if (seg === "externalDocs") return "externalDocs";
      return "unknown";
    case "schemaPropMap":
      return "schema";
    case "schemaList":
      return isIndex(seg) ? "schema" : "unknown";
    case "components":
      if (seg === "schemas") return "componentSchemaMap";
      if (seg === "parameters") return "componentParameterMap";
      if (seg === "requestBodies") return "componentRequestBodyMap";
      if (seg === "responses") return "componentResponseMap";
      if (seg === "securitySchemes") return "componentSecuritySchemeMap";
      if (seg === "headers") return "componentHeaderMap";
      if (seg === "examples") return "componentExampleMap";
      if (seg === "links") return "componentLinkMap";
      if (seg === "callbacks") return "componentCallbackMap";
      if (seg === "pathItems") return "componentPathItemMap";
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
    case "componentHeaderMap":
      return "header";
    case "componentExampleMap":
      return "example";
    case "componentLinkMap":
      return "link";
    case "componentCallbackMap":
      return "callback";
    case "componentPathItemMap":
      return "pathItem";
    case "securityScheme":
      if (seg === "flows") return "oauthFlows";
      return "unknown";
    case "oauthFlows":
      if (seg === "implicit" || seg === "password" || seg === "clientCredentials" || seg === "authorizationCode") {
        return "oauthFlow";
      }
      return "unknown";
    default:
      return "unknown";
  }
}
