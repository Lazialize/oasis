/** RFC 6901 JSON Pointer escaping/unescaping and (de)composition into segments. */

export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
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
 */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  const raw = pointer.startsWith("/") ? pointer.slice(1) : pointer;
  if (raw === "") return [""];
  return raw.split("/").map((seg) => unescapePointerSegment(seg));
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
 * Split a JSON Pointer taken from a `$ref` URI fragment (e.g. "#/paths/~1users/get" with the
 * leading "#" already stripped) into unescaped segments. Per RFC 6901 §6, a URI fragment carries an
 * extra percent-encoding layer on top of the pointer's own `~1`/`~0` escaping; that layer is undone
 * here, exactly once, before RFC 6901 unescaping — segments are split on the *raw* (not yet decoded)
 * string first so an encoded `%2F` cannot masquerade as a pointer separator. Segments that are never
 * percent-encoded (the common case) round-trip unchanged. Plain, non-fragment pointers (e.g. the
 * public `nodeAtPointer` API) must go through `parsePointer` instead — applying this decoding there
 * would corrupt a literal `%`-containing key.
 */
export function parseFragmentPointer(fragment: string): string[] {
  if (fragment === "") return [];
  const raw = fragment.startsWith("/") ? fragment.slice(1) : fragment;
  if (raw === "") return [""];
  return raw.split("/").map((seg) => unescapePointerSegment(safeDecodeURIComponent(seg)));
}
