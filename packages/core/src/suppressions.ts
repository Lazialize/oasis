/**
 * Inline lint suppression directives, expressed as YAML comments:
 *
 * - `# oasis-disable-next-line <rule> [<rule>...]` suppresses the listed rules (or every rule,
 *   if none listed) for diagnostics whose range starts on the line immediately following the
 *   comment.
 * - `# oasis-disable-file <rule> [<rule>...]` suppresses the listed rules (or every rule) for
 *   the whole file, regardless of where in the file the comment appears.
 *
 * Extraction walks the `yaml` package's CST (concrete syntax tree) rather than scanning raw text
 * line-by-line: the CST lexer only ever produces `comment` tokens for genuine YAML comments, so
 * directive-looking text inside a block scalar (`|`/`>`) or a quoted string is left as part of
 * that scalar's `source` and never turned into a comment token. A plain regex scan over raw text
 * can't tell the two apart and would treat commented-out-looking text inside a description body
 * as a real directive.
 *
 * We don't rely on the full `Document`'s comment attachment to nodes (via `parseDocument`)
 * because that attachment is not reliable enough for line-addressed lookups (a comment on its
 * own line doesn't always attach to the node that starts on the next line, e.g. at the end of a
 * file or before a sequence item). Instead we walk the raw CST tokens directly and use a
 * `LineCounter` fed by the same `Parser` pass to convert each comment token's offset to a
 * zero-based line, which stays trivially consistent with `Range.start.line`.
 *
 * JSON documents don't support comments, so this naturally does nothing for them; the limitation
 * is documented in README.md rather than special-cased here.
 */
import { LineCounter, Parser } from "yaml";
import type { CST } from "yaml";
import { positionAtOffset } from "./position.ts";

/** The set of rule names a directive suppresses, or "all" when no rule names were given. */
export type SuppressedRules = "all" | Set<string>;

export interface FileSuppressions {
  /** Rules suppressed for the entire file by an `oasis-disable-file` comment anywhere in it. */
  file: SuppressedRules | undefined;
  /** Zero-based line number -> rules suppressed on that line, from an `oasis-disable-next-line` comment on the previous line. */
  nextLine: Map<number, SuppressedRules>;
}

// Matched against a single comment token's own source text (which always starts with `#`), not
// against a raw line, so these are anchored to the start of the string.
const NEXT_LINE_RE = /^#\s*oasis-disable-next-line\b(.*)$/;
const FILE_RE = /^#\s*oasis-disable-file\b(.*)$/;

function parseRuleNames(rest: string): SuppressedRules {
  const names = rest
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  return names.length === 0 ? "all" : new Set(names);
}

function mergeSuppressedRules(a: SuppressedRules | undefined, b: SuppressedRules): SuppressedRules {
  if (a === "all" || b === "all") return "all";
  if (!a) return b;
  return new Set([...a, ...b]);
}

/** A CST token that carries only source text at a single offset (comments, among others). */
type SourceLikeToken = { type: string; offset: number; source: string };

function isSourceLikeToken(value: unknown): value is SourceLikeToken {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { offset?: unknown }).offset === "number" &&
    typeof (value as { source?: unknown }).source === "string"
  );
}

/** Recursively collect every `comment` token anywhere in a CST token (or array of tokens). */
function collectCommentTokens(token: unknown, out: SourceLikeToken[]): void {
  if (Array.isArray(token)) {
    for (const item of token) collectCommentTokens(item, out);
    return;
  }
  if (typeof token !== "object" || token === null) return;

  if (isSourceLikeToken(token) && token.type === "comment") {
    out.push(token);
    return;
  }

  // Collections' `items` are pair-like objects ({start, key, sep, value}), not tokens
  // themselves, so recurse into their fields directly rather than treating them as tokens.
  const record = token as Record<string, unknown>;
  for (const field of ["start", "sep", "end", "props", "key", "value", "items"]) {
    if (field in record) collectCommentTokens(record[field], out);
  }
}

/** Scan a document's CST for `oasis-disable-*` comment directives. */
export function extractSuppressions(text: string): FileSuppressions {
  let file: SuppressedRules | undefined;
  const nextLine = new Map<number, SuppressedRules>();

  const lineCounter = new LineCounter();
  const comments: SourceLikeToken[] = [];

  try {
    const parser = new Parser(lineCounter.addNewLine);
    for (const token of parser.parse(text)) {
      collectCommentTokens(token as unknown as CST.Token, comments);
    }
  } catch {
    // Best-effort: an unparseable document (or one whose separate full parse already reports a
    // parse-error diagnostic) simply has no suppressions rather than crashing the linter.
    return { file, nextLine };
  }

  for (const comment of comments) {
    const fileMatch = FILE_RE.exec(comment.source);
    if (fileMatch) {
      file = mergeSuppressedRules(file, parseRuleNames(fileMatch[1] ?? ""));
      continue;
    }

    const nextLineMatch = NEXT_LINE_RE.exec(comment.source);
    if (nextLineMatch) {
      const rules = parseRuleNames(nextLineMatch[1] ?? "");
      const commentLine = positionAtOffset(lineCounter, comment.offset).line;
      const targetLine = commentLine + 1;
      nextLine.set(targetLine, mergeSuppressedRules(nextLine.get(targetLine), rules));
    }
  }

  return { file, nextLine };
}

/** Whether `ruleName` is suppressed at `line` (zero-based) according to `suppressions`. */
export function isSuppressed(suppressions: FileSuppressions, ruleName: string, line: number): boolean {
  if (suppressions.file && (suppressions.file === "all" || suppressions.file.has(ruleName))) return true;
  const nextLine = suppressions.nextLine.get(line);
  if (nextLine && (nextLine === "all" || nextLine.has(ruleName))) return true;
  return false;
}
