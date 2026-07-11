import { isScalar } from "yaml";
import { nodeAtPosition, offsetAtPosition } from "@oasis/core";
import type { OasisDocument, Position } from "@oasis/core";

export interface RefAtPosition {
  /** JSON Pointer of the `$ref` (or ref-like) scalar node itself. */
  pointer: string;
  /** The raw `$ref` string value, e.g. "./other.yaml#/components/schemas/Foo" or "#/components/schemas/Foo". */
  refString: string;
}

/**
 * If `position` lands on a `$ref` value, or on any string that looks like a JSON-Pointer-style
 * reference (`#/...` or a relative-file-plus-fragment form), return it. Otherwise undefined.
 */
export function findRefAtPosition(doc: OasisDocument, position: Position): RefAtPosition | undefined {
  const offset = offsetAtPosition(doc.lineCounter, position);
  const found = nodeAtPosition(doc, offset);
  if (!found) return undefined;
  if (!isScalar(found.node)) return undefined;

  const value = found.node.value;
  if (typeof value !== "string") return undefined;

  const isRefKey = found.pointer.endsWith("/$ref") || found.pointer === "/$ref";
  const looksLikeRef = isRefKey || value.includes("#/") || /^\.{1,2}\//.test(value);
  if (!looksLikeRef) return undefined;

  return { pointer: found.pointer, refString: value };
}

/** Drop the last segment of a JSON Pointer, e.g. "/a/b/$ref" -> "/a/b". */
export function parentPointer(pointer: string): string {
  const idx = pointer.lastIndexOf("/");
  if (idx <= 0) return "";
  return pointer.slice(0, idx);
}
