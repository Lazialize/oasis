import { isSeq } from "yaml";
import type { Node } from "yaml";
import {
  isNamedEntryContainer,
  NAMED_ENTRY_CONTAINER_KEYS,
  NAMED_ENTRY_CONTAINER_KEYS_31,
  NAMED_ENTRY_CONTAINER_KEYS_32,
} from "./named-containers.ts";
import type { OpenApiVersion } from "./version.ts";

/**
 * Keys whose value is arbitrary literal instance data (JSON Schema `example`/`default`/`enum`/
 * `const`) rather than a place references or anchors can legitimately appear. `examples` is
 * literal only in its sequence form; its OpenAPI map form contains named Example Objects.
 */
export function isLiteralDataKey(key: string, value: Node): boolean {
  if (key === "examples") return isSeq(value);
  return key === "example" || key === "default" || key === "enum" || key === "const";
}

/**
 * Keys whose map values are user/spec-named entries (component names, status codes, media types,
 * property names, etc.) rather than structural member names. Literal-data keywords used as entry
 * names remain structural; whether `x-*` is an extension is tracked separately for patterned maps.
 */
export const CONTAINER_KEYS = new Set<string>([
  ...NAMED_ENTRY_CONTAINER_KEYS,
  ...NAMED_ENTRY_CONTAINER_KEYS_31,
  ...NAMED_ENTRY_CONTAINER_KEYS_32,
]);

export function isContainerKey(key: string, value: Node, version?: OpenApiVersion): boolean {
  return isNamedEntryContainer(key, value, version);
}

/**
 * Whether `x-*` keys in a named map are Specification Extensions rather than genuine entry names.
 * A Responses Object is patterned by status code and explicitly allows extensions. The similarly
 * named `components.responses` section is instead an arbitrary component-name map.
 */
export function containerExtensionsAreOpaque(key: string, parentIsComponentsObject: boolean): boolean {
  return key === "paths" || key === "content" || (key === "responses" && !parentIsComponentsObject);
}
