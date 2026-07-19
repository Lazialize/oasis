import { isMap, isScalar } from "yaml";
import type { OasisDocument } from "./parse.ts";
import { resolveUriReference, stripUriFragment } from "./uri.ts";

export type OpenApiVersion = "3.0" | "3.1" | "3.2";

/** Detect the OpenAPI major.minor version from the document's `openapi` field. */
export function detectVersion(doc: OasisDocument): OpenApiVersion | undefined {
  const root = doc.yamlDoc.contents;
  if (!isMap(root)) return undefined;

  const pair = root.items.find((p) => isScalar(p.key) && p.key.value === "openapi");
  if (!pair || !isScalar(pair.value)) return undefined;

  let value: unknown = pair.value.value;

  // An unquoted `openapi: 3.0` (or `3.10`) parses as a YAML *number*, and JS's `String()` coercion
  // loses information both ways: `3.0` -> `3` (undetectable) and `3.10` -> `3.1` (misdetected as
  // 3.1.x). Recover the exact source text of the scalar instead of trusting the coerced JS value.
  // Quoted values (`"3.0"`) already parse as strings and are unaffected.
  if (typeof value === "number") {
    const range = pair.value.range;
    value = range ? doc.text.slice(range[0], range[1]) : String(value);
  }

  if (typeof value !== "string") return undefined;

  // Match "3.0", "3.0.x", "3.0-x" (but not "3.10")
  if (/^3\.0($|\.|\-)/.test(value)) return "3.0";
  // Match "3.1", "3.1.x", "3.1-x" (but not "3.10" or "3.11")
  if (/^3\.1($|\.|\-)/.test(value)) return "3.1";
  // Match "3.2", "3.2.x", "3.2-x" (but not "3.20" or "3.21")
  if (/^3\.2($|\.|\-)/.test(value)) return "3.2";
  return undefined;
}

/** Whether the version uses the full JSON Schema 2020-12 Schema Object dialect. */
export function hasJsonSchema202012(version: OpenApiVersion | undefined): boolean {
  return version === "3.1" || version === "3.2";
}

/**
 * Effective base URI of an OpenAPI document. OpenAPI 3.2 adds `$self`; earlier versions and 3.2
 * documents without it use their retrieval URI.
 */
export function documentBaseUri(doc: OasisDocument, retrievalUri: string): string {
  if (detectVersion(doc) !== "3.2") return stripUriFragment(retrievalUri);
  const root = doc.yamlDoc.contents;
  if (!isMap(root)) return stripUriFragment(retrievalUri);
  const pair = root.items.find((p) => isScalar(p.key) && p.key.value === "$self");
  if (!pair || !isScalar(pair.value) || typeof pair.value.value !== "string") {
    return stripUriFragment(retrievalUri);
  }
  return stripUriFragment(resolveUriReference(retrievalUri, pair.value.value));
}
