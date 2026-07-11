import { formatPointer } from "@oasis/core";
import type { Position } from "@oasis/core";

/**
 * Result of the indentation-based fallback: the cursor sits on a line that looks like a
 * partially-typed (or empty) mapping key, and we've derived which enclosing mapping it belongs
 * to purely from line indentation — no valid AST node covers this case (or the AST node is
 * misleading, e.g. after a YAML syntax error jumps the parse back to a shallower level).
 */
export interface IndentationFallbackResult {
  /** JSON Pointer of the enclosing mapping, relative to the document's own root kind. */
  containerPointer: string;
  /** The text already typed on this line (trimmed), used as the completion filter/prefix. */
  prefix: string;
  /** Range covering `prefix` on the line, to replace with the accepted completion. */
  replaceRange: { start: Position; end: Position };
}

const KEY_WORD_RE = /^[A-Za-z0-9_.$-]*$/;

/** Number of leading space characters on `line` (tabs are not treated as indentation here). */
function leadingSpaces(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === " ") count++;
  return count;
}

/**
 * If `line` (trimmed) looks like `key:` or `- key:` (optionally quoted), return the key name.
 * Returns undefined for comments, blank lines, or anything that isn't recognizably a mapping key.
 */
function extractKeySegment(line: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return undefined;
  // Sequence items (`- foo` or `- key: value`) would need an array index segment we don't track;
  // bail rather than guess a wrong pointer.
  if (trimmed.startsWith("-")) return undefined;

  const match = /^(?:'([^']*)'|"([^"]*)"|([^:#\s][^:]*?)):(?:\s|$)/.exec(trimmed);
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3];
}

/**
 * Derive the enclosing mapping's JSON Pointer from indentation alone, for a cursor sitting on a
 * line that is either blank (correctly indented, nothing typed yet) or a bare word being typed
 * as a new key (no `:` yet). Walks upward through the raw buffer text — not the AST — looking for
 * the nearest preceding line at each shallower indentation level, collecting its key.
 *
 * Deliberately conservative: bails out (returns undefined) rather than guessing wrong whenever an
 * ancestor line doesn't parse as a simple `key:` line (e.g. sequence items), since a wrong pointer
 * is worse than no fallback.
 */
export function indentationFallback(text: string, position: Position): IndentationFallbackResult | undefined {
  const lines = text.split("\n");
  const line = lines[position.line];
  if (line === undefined) return undefined;

  const beforeCursor = line.slice(0, position.character);
  const prefix = beforeCursor.trim();
  if (!KEY_WORD_RE.test(prefix)) return undefined; // already has `:`, or other non-key content

  const indent = prefix === "" ? beforeCursor.length : beforeCursor.length - prefix.length;

  const keys: string[] = [];
  let frontier = indent;
  for (let i = position.line - 1; i >= 0 && frontier > 0; i--) {
    const candidate = lines[i]!;
    if (candidate.trim() === "") continue;
    const candidateIndent = leadingSpaces(candidate);
    if (candidateIndent >= frontier) continue; // sibling or deeper: not an ancestor
    const key = extractKeySegment(candidate);
    if (key === undefined) return undefined; // can't confidently classify this ancestor level
    keys.unshift(key);
    frontier = candidateIndent;
  }

  return {
    containerPointer: formatPointer(keys),
    prefix,
    replaceRange: {
      start: { line: position.line, character: indent },
      end: position,
    },
  };
}
