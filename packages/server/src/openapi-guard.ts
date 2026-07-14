// Root-aware "looks like OpenAPI" guard (issue #52). Mirrored in editors/vscode/src/extension.ts —
// the extension bundles with npm/esbuild and cannot import from this Bun workspace package, so any
// change here must be copied there (both sites carry this note).
//
// The extension's client-side guard only applies when no oasis.config.jsonc is present in the
// workspace; once project mode is active the client syncs every yaml/json/jsonc document and the
// server decides membership itself (see findOwningEntry in workspace.ts). Files that are neither a
// project member nor look like an OpenAPI document are silently ignored by the server so they
// don't get spuriously linted as a broken standalone entry.
//
// "Looks like an OpenAPI document" means an `openapi` property on the document's ROOT mapping.
// A naive multiline regex also matches nested keys — `metadata:\n  openapi: not-a-root-key` or
// `{"metadata":{"openapi":"x"}}` — wrongly syncing and linting unrelated files, so this scanner is
// nesting-aware: zero-indent lines only for YAML block mappings, brace/bracket depth 1 for
// JSON / flow mappings.

/** `true` when the first non-whitespace character at/after `index` is `:`. */
function nextNonSpaceIsColon(text: string, index: number): boolean {
  let i = index;
  while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\r" || text[i] === "\n")) i++;
  return text[i] === ":";
}

/**
 * Whether a flow/JSON mapping starting at `text[start]` (which must be `{`) has a root-level
 * (depth-1) `openapi` key: quoted (`"openapi"` / `'openapi'`) or bare (YAML flow style), followed
 * by `:`. Strings are tokenized so `"openapi"` at deeper nesting, in value position, or inside
 * another string never matches.
 */
function hasRootOpenApiKeyInFlow(text: string, start: number): boolean {
  let depth = 0;
  let i = start;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let value = "";
      i++;
      while (i < n && text[i] !== quote) {
        if (quote === '"' && text[i] === "\\") i++; // step over the escape; keep the escaped char
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

/** Whether `text` declares an `openapi` property on its ROOT mapping (YAML or JSON). */
export function looksLikeOpenApi(text: string): boolean {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  // JSON documents (and YAML documents whose root is a flow mapping) start with `{` — possibly
  // after leading whitespace.
  const firstNonSpace = src.search(/\S/);
  if (firstNonSpace !== -1 && src[firstNonSpace] === "{") {
    return hasRootOpenApiKeyInFlow(src, firstNonSpace);
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
