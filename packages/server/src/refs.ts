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

/**
 * Raw-text description of a `$ref` value being typed, for building a completion `TextEdit`. Works
 * off the buffer text directly rather than the AST: the `yaml` package's error recovery for
 * unterminated quoted scalars sometimes truncates `node.value` by a character, which would corrupt
 * `filterText`/`insertText` if we trusted it instead of the raw line.
 */
export interface RefValueEditContext {
  /** Quote character already typed before the value (`'` or `"`), if any. */
  quoteChar: "'" | '"' | undefined;
  /** Whether a matching closing quote already follows the cursor on this line. */
  hasClosingQuote: boolean;
  /** Range covering the value text typed so far (excluding quotes), to replace on accept. */
  replaceRange: { start: Position; end: Position };
  /** The value text typed so far (excluding quotes), used as the completion filter/prefix. */
  typed: string;
}

const REF_KEY_RE = /(["']?\$ref["']?\s*:\s*)(.*)$/;

/**
 * If the cursor sits right after a `$ref:` (or JSON `"$ref":`) key on the same line — with or
 * without an opening quote, with or without a value typed yet — describe the value's raw-text
 * extent so completion can replace exactly what's been typed. Returns undefined if the current
 * line doesn't look like a `$ref` value position at all.
 */
export function findRefValueEditContext(text: string, position: Position): RefValueEditContext | undefined {
  const lines = text.split("\n");
  const line = lines[position.line];
  if (line === undefined) return undefined;

  const before = line.slice(0, position.character);
  const match = REF_KEY_RE.exec(before);
  if (!match) return undefined;

  const afterColon = match[2]!;
  const colonEndCol = position.character - afterColon.length;
  const first = afterColon[0];
  const quoteChar: "'" | '"' | undefined = first === "'" || first === '"' ? first : undefined;
  const valueStartCol = quoteChar ? colonEndCol + 1 : colonEndCol;
  const typed = quoteChar ? afterColon.slice(1) : afterColon;

  const afterCursor = line.slice(position.character);
  const hasClosingQuote = quoteChar !== undefined && afterCursor.startsWith(quoteChar);

  return {
    quoteChar,
    hasClosingQuote,
    typed,
    replaceRange: {
      start: { line: position.line, character: valueStartCol },
      end: position,
    },
  };
}
