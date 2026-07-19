import { isMap } from "yaml";
import type { Node } from "yaml";
import type { OpenApiVersion } from "./version.ts";

/** Maps whose keys are user/spec-defined entry names rather than structural keyword names. */
export const NAMED_ENTRY_CONTAINER_KEYS = new Set<string>([
  "callbacks",
  "content",
  "definitions",
  "encoding",
  "examples",
  "headers",
  "links",
  "mapping",
  "parameters",
  "paths",
  "properties",
  "requestBodies",
  "responses",
  "schemas",
  "scopes",
  "securitySchemes",
  "variables",
]);

/** Named maps introduced by OpenAPI 3.1 / JSON Schema 2020-12 and retained in 3.2. */
export const NAMED_ENTRY_CONTAINER_KEYS_31 = new Set<string>([
  "$defs",
  "dependentSchemas",
  "pathItems",
  "patternProperties",
  "webhooks",
]);

/** Named maps introduced by OpenAPI 3.2. */
export const NAMED_ENTRY_CONTAINER_KEYS_32 = new Set<string>([
  "additionalOperations",
  "mediaTypes",
]);

/**
 * Whether `value` is a map of named entries. Version is optional for standalone callers; when it
 * is known, 3.1+ containers are disabled only for 3.0 documents.
 */
export function isNamedEntryContainer(key: string, value: Node, version?: OpenApiVersion): boolean {
  if (!isMap(value)) return false;
  if (NAMED_ENTRY_CONTAINER_KEYS.has(key)) return true;
  if (version !== "3.0" && NAMED_ENTRY_CONTAINER_KEYS_31.has(key)) return true;
  return (version === undefined || version === "3.2") && NAMED_ENTRY_CONTAINER_KEYS_32.has(key);
}
