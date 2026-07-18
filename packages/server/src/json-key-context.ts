import type { Position } from "@oasis/core";

/**
 * Describes how to build a syntactically valid JSON/JSONC key edit at a fresh insertion point.
 */
export interface JsonKeyContext {
  /** Zero-width insertion range at the cursor (a new key is inserted, nothing is replaced). */
  replaceRange: { start: Position; end: Position };
  /** Whether a leading comma must separate the new member from a preceding sibling member. */
  leadingComma: boolean;
}

/**
 * For a cursor sitting at a fresh key-insertion point inside a JSON object, describe how to build a
 * syntactically valid key edit: the (zero-width) insertion range and whether a leading comma is
 * needed to separate the new member from a preceding sibling.
 *
 * Deliberately conservative — returns undefined (so no edit is offered) unless the new member can be
 * appended as the object's *last* member. A following sibling would require a trailing comma placed
 * after the value the user has yet to type, which we cannot insert now; a cursor mid-token, right
 * after a `:`, or inside an array is likewise not a safe fresh-key position. The caller has already
 * confirmed (via the AST) that the enclosing container is a mapping.
 */
export function jsonKeyInsertionContext(text: string, offset: number, position: Position): JsonKeyContext | undefined {
  // Must be a fresh insertion point: the character immediately before the cursor is whitespace, the
  // object's `{`, or a member-separating `,` — never the tail of a token being typed.
  const prev = text[offset - 1];
  if (prev !== undefined && !/\s/.test(prev) && prev !== "{" && prev !== ",") return undefined;

  // Nearest non-whitespace char before the cursor decides whether a preceding sibling exists.
  let i = offset - 1;
  while (i >= 0 && /\s/.test(text[i]!)) i--;
  if (i < 0) return undefined; // no enclosing content at all
  const before = text[i]!;
  if (before === "[" || before === ":") return undefined; // array element / value position, not a key
  const leadingComma = before !== "{" && before !== ",";

  // Nearest non-whitespace char after the cursor: only a bare `}` (append as last member) is safe.
  let j = offset;
  while (j < text.length && /\s/.test(text[j]!)) j++;
  if (text[j] !== "}") return undefined;

  return { leadingComma, replaceRange: { start: position, end: position } };
}
