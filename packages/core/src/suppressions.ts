/**
 * Inline lint suppression directives, expressed as YAML comments:
 *
 * - `# oasis-disable-next-line <rule> [<rule>...]` suppresses the listed rules (or every rule,
 *   if none listed) for diagnostics whose range starts on the line immediately following the
 *   comment.
 * - `# oasis-disable-file <rule> [<rule>...]` suppresses the listed rules (or every rule) for
 *   the whole file, regardless of where in the file the comment appears.
 *
 * Extraction is a plain text scan rather than an AST walk: directives are comments, and the
 * `yaml` library's comment attachment to nodes is not reliable enough for line-addressed lookups
 * (a comment on its own line doesn't always attach to the node that starts on the next line, e.g.
 * at the end of a file or before a sequence item). Scanning raw text keeps this simple and keeps
 * line numbers trivially consistent with `Range.start.line` (both zero-based).
 *
 * JSON documents don't support comments, so this naturally does nothing for them; the limitation
 * is documented in README.md rather than special-cased here.
 */

/** The set of rule names a directive suppresses, or "all" when no rule names were given. */
export type SuppressedRules = "all" | Set<string>;

export interface FileSuppressions {
  /** Rules suppressed for the entire file by an `oasis-disable-file` comment anywhere in it. */
  file: SuppressedRules | undefined;
  /** Zero-based line number -> rules suppressed on that line, from an `oasis-disable-next-line` comment on the previous line. */
  nextLine: Map<number, SuppressedRules>;
}

const NEXT_LINE_RE = /(?:^|\s)#\s*oasis-disable-next-line\b(.*)$/;
const FILE_RE = /(?:^|\s)#\s*oasis-disable-file\b(.*)$/;

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

/** Scan a document's raw source text for `oasis-disable-*` comment directives. */
export function extractSuppressions(text: string): FileSuppressions {
  let file: SuppressedRules | undefined;
  const nextLine = new Map<number, SuppressedRules>();

  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    const fileMatch = FILE_RE.exec(line);
    if (fileMatch) {
      file = mergeSuppressedRules(file, parseRuleNames(fileMatch[1] ?? ""));
      continue;
    }

    const nextLineMatch = NEXT_LINE_RE.exec(line);
    if (nextLineMatch) {
      const rules = parseRuleNames(nextLineMatch[1] ?? "");
      const targetLine = i + 1;
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
