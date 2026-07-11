import { isMap, isScalar } from "yaml";
import type { OasisDocument } from "./parse.ts";

export type OpenApiVersion = "3.0" | "3.1";

/** Detect the OpenAPI major.minor version from the document's `openapi` field. */
export function detectVersion(doc: OasisDocument): OpenApiVersion | undefined {
  const root = doc.yamlDoc.contents;
  if (!isMap(root)) return undefined;

  const pair = root.items.find((p) => isScalar(p.key) && p.key.value === "openapi");
  if (!pair || !isScalar(pair.value)) return undefined;

  const value = pair.value.value;
  if (typeof value !== "string") return undefined;

  if (/^3\.0\.\d+/.test(value)) return "3.0";
  if (/^3\.1\.\d+/.test(value)) return "3.1";
  return undefined;
}
