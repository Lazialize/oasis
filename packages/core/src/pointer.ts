/** RFC 6901 JSON Pointer escaping/unescaping and (de)composition into segments. */

export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Check if a segment contains valid RFC 6901 tilde escapes (only ~0 and ~1 allowed).
 * Returns true if the segment is valid, false if it contains invalid escapes.
 */
function isValidPointerSegment(segment: string): boolean {
  // Check for invalid tilde sequences:
  // - Tilde not followed by anything (trailing ~)
  // - Tilde followed by anything other than 0 or 1
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] === "~") {
      const next = segment[i + 1];
      if (next !== "0" && next !== "1") {
        return false;
      }
    }
  }
  return true;
}

export function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * `decodeURIComponent`, but tolerant of malformed percent-encoding (e.g. a lone trailing `%`):
 * a `$ref` fragment is user-authored text, and a bad escape must never crash resolution — it's
 * treated as literal text instead (consistent with how callers turn a bad ref into a diagnostic
 * rather than an exception).
 */
export function safeDecodeURIComponent(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Split a plain RFC 6901 JSON Pointer string (e.g. "/paths/~1users/get") into unescaped segments.
 * This implements RFC 6901 alone: only `~1`/`~0` escaping is undone, with no URI percent-decoding.
 * A pointer that comes from a `$ref` URI fragment carries an *additional* percent-encoding layer on
 * top of this — use `parseFragmentPointer` for that case instead.
 *
 * Per RFC 6901, a JSON Pointer is either an empty string or a sequence of reference tokens each
 * prefixed by `/`. Inside a token, `~` may only occur as `~0` (represents `~`) or `~1` (represents `/`).
 *
 * Returns the parsed segments, or `undefined` if the pointer is malformed (e.g., missing leading slash,
 * invalid tilde escapes).
 */
export function parsePointer(pointer: string): string[] | undefined {
  if (pointer === "") return [];
  // RFC 6901: a non-empty pointer must start with "/"
  if (!pointer.startsWith("/")) return undefined;
  const raw = pointer.slice(1);
  if (raw === "") return [""];

  const segments = raw.split("/");
  // Validate all segments have valid tilde escapes before unescaping
  for (const seg of segments) {
    if (!isValidPointerSegment(seg)) return undefined;
  }
  return segments.map((seg) => unescapePointerSegment(seg));
}

/**
 * Join unescaped segments back into a plain RFC 6901 JSON Pointer string, the exact inverse of
 * `parsePointer`.
 */
export function formatPointer(segments: string[]): string {
  if (segments.length === 0) return "";
  return "/" + segments.map((seg) => escapePointerSegment(seg)).join("/");
}

/**
 * Canonicalize a `$ref` JSON Pointer fragment (a URI-reference fragment, e.g.
 * "/components/schemas/%46oo") into a pure RFC 6901 pointer ("/components/schemas/Foo"): the
 * fragment's URI percent-encoding layer is undone once, then the segments are re-emitted with only
 * JSON Pointer (`~0`/`~1`) escaping. URI-equivalent spellings of the same target (`/Foo` vs
 * `/%46oo`, differently escaped segments) therefore collapse to one identity string, so callers can
 * key a resolved target by its canonical pointer instead of its raw spelling.
 *
 * Returns `undefined` when `fragment` is malformed (see `parseFragmentPointer`) — a malformed
 * fragment has no canonical identity, and callers must treat that as an unresolved reference rather
 * than fabricate one.
 */
export function canonicalPointer(fragment: string): string | undefined {
  const segments = parseFragmentPointer(fragment);
  return segments === undefined ? undefined : formatPointer(segments);
}

/**
 * Split a JSON Pointer taken from a `$ref` URI fragment (e.g. "#/paths/~1users/get" with the
 * leading "#" already stripped) into unescaped segments. Per RFC 6901 §6, a URI fragment carries an
 * extra percent-encoding layer on top of the pointer's own `~1`/`~0` escaping; that layer is undone
 * here, exactly once, before RFC 6901 unescaping — segments are split on the *raw* (not yet decoded)
 * string first so an encoded `%2F` cannot masquerade as a pointer separator. Segments that are never
 * percent-encoded (the common case) round-trip unchanged. Plain, non-fragment pointers (e.g. the
 * public `nodeAtPointer` API) must go through `parsePointer` instead — applying this decoding there
 * would corrupt a literal `%`-containing key.
 *
 * Per RFC 6901, `~` may only occur as `~0` or `~1` inside a token. That's validated here — reusing
 * `parsePointer`'s own tilde-escape check — on each *percent-decoded* segment (so a malformed escape
 * hidden behind percent-encoding, e.g. `%7E2` decoding to the literal text `~2`, is caught too) and
 * before RFC 6901 unescaping. Returns `undefined` for a malformed fragment instead of silently
 * treating the invalid `~` sequence as literal text, which would let an invalid `$ref` resolve to a
 * real (but unintended) node.
 */
export function parseFragmentPointer(fragment: string): string[] | undefined {
  if (fragment === "") return [];
  const raw = fragment.startsWith("/") ? fragment.slice(1) : fragment;
  if (raw === "") return [""];
  const decoded = raw.split("/").map((seg) => safeDecodeURIComponent(seg));
  for (const seg of decoded) {
    if (!isValidPointerSegment(seg)) return undefined;
  }
  return decoded.map((seg) => unescapePointerSegment(seg));
}
