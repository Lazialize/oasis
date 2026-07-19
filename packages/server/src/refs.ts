import { isScalar } from "yaml";
import { foundRefForNode, nodeAtPosition, offsetAtPosition, resolveRef } from "@oasis/core";
import type { OasisDocument, Position, Range, ResolvedRef, WorkspaceGraph } from "@oasis/core";
import { classifyPointer, inferRootKind } from "./keywords.ts";

export interface RefAtPosition {
  /** JSON Pointer of the `$ref` (or ref-like) scalar node itself. */
  pointer: string;
  /** The raw `$ref` string value, e.g. "./other.yaml#/components/schemas/Foo" or "#/components/schemas/Foo". */
  refString: string;
  /** Source range of the scalar node (includes surrounding quotes, if any). */
  range: Range;
}

/**
 * If `position` lands on a scalar that is a *genuine* reference occurrence, return it. Otherwise
 * undefined.
 *
 * "Genuine" is decided semantically, not by the shape of the text (issue #182): `$ref`,
 * `$dynamicRef`, and discriminator URI-style mappings are recognized via `foundRefForNode`, backed
 * by the same semantic walk (`findRefs`) that builds the workspace graph — it already treats
 * literal-data contexts (Schema Object `example`/`examples`/`default`/`enum`/`const` values,
 * Specification Extension `x-*` payloads, and other Any-valued fields) as opaque, so a ref-looking
 * string sitting in ordinary example data is never mistaken for a reference. Link Object
 * `operationRef` is a reference-bearing field the core walk doesn't track (the linter validates it
 * separately), so it's recognized here by its exact field position instead of by text shape.
 */
export function findRefAtPosition(graph: WorkspaceGraph, doc: OasisDocument, position: Position): RefAtPosition | undefined {
  const offset = offsetAtPosition(doc.lineCounter, position);
  const found = nodeAtPosition(doc, offset);
  if (!found) return undefined;
  if (!isScalar(found.node)) return undefined;

  const value = found.node.value;
  if (typeof value !== "string") return undefined;

  const occurrence = foundRefForNode(graph, doc, found.node);
  if (occurrence) return { pointer: found.pointer, refString: occurrence.value, range: occurrence.range };

  const isOperationRef = found.pointer.endsWith("/operationRef") &&
    classifyPointer(parentPointer(found.pointer), inferRootKind(doc, graph)) === "link";
  if (!isOperationRef) return undefined;

  return { pointer: found.pointer, refString: value, range: found.range };
}

/**
 * Cursor on a `$ref` (or ref-like string) -> its resolved target, or undefined if the cursor isn't
 * on a ref, or the ref doesn't resolve. Shared by handlers (`definition`, `hover`) that both start
 * with this exact "find the ref under the cursor, then resolve it" sequence.
 */
export function resolveRefAtPosition(graph: WorkspaceGraph, doc: OasisDocument, position: Position): ResolvedRef | undefined {
  const found = findRefAtPosition(graph, doc, position);
  if (!found) return undefined;

  const result = resolveRef(graph, doc, found.refString, found.range);
  if (!result.ok) return undefined;

  return result;
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
