// Root-aware "looks like OpenAPI" guard (issue #52, issue #122). Mirrored in
// packages/server/src/openapi-guard.ts — this extension bundles with npm/esbuild and cannot
// import from that Bun workspace package, so any change here must be copied there (both sites
// carry this note).
//
// The extension's client-side guard only applies when no oasis.config.jsonc is present in the
// workspace; once project mode is active the client syncs every yaml/json/jsonc document and the
// server decides membership itself (see findOwningEntry in packages/server/src/workspace.ts).
// Files that are neither a project member nor look like an OpenAPI document are silently ignored
// by the server so they don't get spuriously linted as a broken standalone entry.
//
// "Looks like an OpenAPI document" means an `openapi` property on the document's ROOT mapping.
// A naive multiline regex also matches nested keys — `metadata:\n  openapi: not-a-root-key` or
// `{"metadata":{"openapi":"x"}}` — wrongly syncing and linting unrelated files, so this scanner is
// nesting-aware: zero-indent lines only for YAML block mappings, brace/bracket depth 1 for
// JSON / flow mappings.
//
// Issue #122 hardened this from a partial character scanner towards proper tokenization: YAML
// (`#`) and JSONC (`//`, `/* */`) comments are skipped rather than scanned as mapping content,
// double-quoted JSON string escapes are decoded (not copied) before comparing against `openapi`,
// and a bounded document prefix — leading whitespace/comment lines, `%` directives, and a `---`
// document-start marker — is skipped before classifying the root as flow (`{`) or block.

/** `true` when the first non-whitespace character at/after `index` is `:`. */
function nextNonSpaceIsColon(text: string, index: number): boolean {
  let i = index;
  while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\r" || text[i] === "\n")) i++;
  return text[i] === ":";
}

/** Decodes a JSON double-quoted string escape sequence starting at `text[i]` (the backslash).
 * Returns the decoded character(s) and the index just past the consumed escape. Unrecognized
 * escapes fall back to the character itself (lenient — this is a guard, not a validator). */
function decodeJsonEscape(text: string, i: number): { value: string; next: number } {
  const esc = text[i + 1];
  switch (esc) {
    case '"':
      return { value: '"', next: i + 2 };
    case "\\":
      return { value: "\\", next: i + 2 };
    case "/":
      return { value: "/", next: i + 2 };
    case "b":
      return { value: "\b", next: i + 2 };
    case "f":
      return { value: "\f", next: i + 2 };
    case "n":
      return { value: "\n", next: i + 2 };
    case "r":
      return { value: "\r", next: i + 2 };
    case "t":
      return { value: "\t", next: i + 2 };
    case "u": {
      const hex = text.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) return { value: String.fromCharCode(Number.parseInt(hex, 16)), next: i + 6 };
      return { value: "u", next: i + 2 };
    }
    default:
      return { value: esc ?? "", next: i + 2 };
  }
}

/**
 * Whether a flow/JSON mapping starting at `text[start]` (which must be `{`) has a root-level
 * (depth-1) `openapi` key: quoted (`"openapi"` / `'openapi'`) or bare (YAML flow style), followed
 * by `:`. Strings are tokenized so `"openapi"` at deeper nesting, in value position, or inside
 * another string never matches. YAML (`#`) and JSONC (`//`, `/* *​/`) comments are skipped rather
 * than scanned as content, and double-quoted string escapes are decoded before comparison.
 */
function hasRootOpenApiKeyInFlow(text: string, start: number): boolean {
  let depth = 0;
  let i = start;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (ch === "#") {
      // YAML comment: runs to end of line, regardless of depth.
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      // JSONC line comment.
      i += 2;
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      // JSONC block comment.
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let value = "";
      i++;
      while (i < n && text[i] !== quote) {
        if (quote === '"' && text[i] === "\\") {
          const decoded = decodeJsonEscape(text, i);
          value += decoded.value;
          i = decoded.next;
          continue;
        }
        value += text[i];
        i++;
      }
      i++; // past the closing quote
      if (depth === 1 && value === "openapi" && nextNonSpaceIsColon(text, i)) return true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth--;
      if (depth <= 0) return false; // root container closed; nothing after it can be a root key
      i++;
      continue;
    }
    if (depth === 1 && /[A-Za-z0-9_$-]/.test(ch)) {
      // Bare word (YAML flow style). Only a key position (followed by `:`) counts.
      let end = i;
      while (end < n && !/[\s:,{}[\]"']/.test(text[end]!)) end++;
      const word = text.slice(i, end);
      i = end;
      if (word === "openapi" && nextNonSpaceIsColon(text, i)) return true;
      continue;
    }
    i++;
  }
  return false;
}

/** A zero-indent YAML block-mapping key `openapi:` (optionally quoted). Nested keys are always
 * indented, and block/plain scalar continuations under a root-level key must be indented too, so a
 * column-0 match can only be a root mapping property. */
const ROOT_OPENAPI_YAML_LINE = /^(['"]?)openapi\1\s*:(\s|$)/;

/**
 * Skips a bounded YAML document prefix — blank lines, `#` comment lines, `%` directives
 * (`%YAML 1.2`), and a `---` document-start marker (with an optional trailing comment) — and
 * returns the absolute index of the first real content character, or -1 if the document is
 * nothing but prefix. A marker line that carries inline content after `---` (`--- {openapi: 3.1.0}`
 * / `--- openapi: 3.1.0`) returns that content's index directly rather than skipping the line.
 */
function skipDocumentPrefix(text: string): number {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const lineStart = i;
    let lineEnd = text.indexOf("\n", i);
    if (lineEnd === -1) lineEnd = n;
    const line = text.slice(lineStart, lineEnd);
    const content = line.trimStart();
    const leadingWs = line.length - content.length;

    if (content === "") {
      i = lineEnd + 1;
      continue;
    }
    if (content[0] === "#") {
      i = lineEnd + 1;
      continue;
    }
    if (content.startsWith("//")) {
      // JSONC line comment before the root `{`.
      i = lineEnd + 1;
      continue;
    }
    if (content[0] === "%") {
      i = lineEnd + 1;
      continue;
    }
    if (content.startsWith("---") && (content.length === 3 || /\s/.test(content[3]!))) {
      const rest = content.slice(3);
      const restContent = rest.trimStart();
      if (restContent === "" || restContent[0] === "#") {
        i = lineEnd + 1;
        continue;
      }
      return lineStart + leadingWs + 3 + (rest.length - restContent.length);
    }
    return lineStart + leadingWs;
  }
  return -1;
}

/** Whether `text` declares an `openapi` property on its ROOT mapping (YAML or JSON). */
export function looksLikeOpenApiText(text: string): boolean {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  // JSON documents (and YAML documents whose root is a flow mapping) start with `{`, possibly
  // after leading whitespace, comments, directives, and/or a `---` document marker.
  const contentIndex = skipDocumentPrefix(src);
  if (contentIndex !== -1 && src[contentIndex] === "{") {
    return hasRootOpenApiKeyInFlow(src, contentIndex);
  }

  for (const rawLine of src.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (ROOT_OPENAPI_YAML_LINE.test(line)) return true;
    // A `---` document-start marker may carry the root content on the same line
    // (`--- {openapi: 3.1.0}` or `--- openapi: 3.1.0` are still root-level).
    if (line.startsWith("---")) {
      const rest = line.slice(3).trimStart();
      if (rest.startsWith("{") && hasRootOpenApiKeyInFlow(rest, 0)) return true;
      if (ROOT_OPENAPI_YAML_LINE.test(rest)) return true;
    }
  }
  return false;
}
