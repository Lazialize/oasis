import { isMap, isScalar } from "yaml";
import type { OasisDocument } from "./parse.ts";

export type OpenApiVersion = "3.0" | "3.1";

/** Detect the OpenAPI major.minor version from the document's `openapi` field. */
export function detectVersion(doc: OasisDocument): OpenApiVersion | undefined {
  const root = doc.yamlDoc.contents;
  if (!isMap(root)) return undefined;

  const pair = root.items.find((p) => isScalar(p.key) && p.key.value === "openapi");
  if (!pair || !isScalar(pair.value)) return undefined;

  let value = pair.value.value;

  // Handle YAML numbers (e.g., unquoted 3.1 in YAML): convert to string
  if (typeof value === "number") {
    value = String(value);
  }

  if (typeof value !== "string") return undefined;

  // Match "3.0", "3.0.x", "3.0-x" (but not "3.10")
  if (/^3\.0($|\.|\-)/.test(value)) return "3.0";
  // Match "3.1", "3.1.x", "3.1-x" (but not "3.10" or "3.11")
  if (/^3\.1($|\.|\-)/.test(value)) return "3.1";
  return undefined;
}
