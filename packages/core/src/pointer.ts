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
 * Split a JSON Pointer string (e.g. "/paths/~1users/get") into unescaped segments. When a pointer
 * comes from a `$ref` fragment (a URI-reference), each segment may additionally be percent-encoded
 * per URI syntax; per RFC 6901 §6 that percent-encoding is undone *before* the `~1`/`~0` JSON
 * Pointer escaping (percent-encoding is a URI-level concern, layered on top of the pointer's own
 * escaping). Segments that are never URI-encoded (the common case) round-trip unchanged.
 */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  const raw = pointer.startsWith("/") ? pointer.slice(1) : pointer;
  if (raw === "") return [""];
  return raw.split("/").map((seg) => unescapePointerSegment(safeDecodeURIComponent(seg)));
}

/**
 * Join unescaped segments back into a JSON Pointer string, as the exact inverse of
 * `parsePointer`. Because `parsePointer` percent-decodes each segment (for `$ref`-fragment
 * pointers), a literal `%` that happens to be followed by two hex digits would be corrupted on
 * re-parse unless it is percent-encoded here. Only that case is encoded — a `%` not followed by
 * hex survives `safeDecodeURIComponent` unchanged — so pointers stay human-readable in
 * diagnostics for the common case.
 */
export function formatPointer(segments: string[]): string {
  if (segments.length === 0) return "";
  return (
    "/" +
    segments
      .map((seg) => escapePointerSegment(seg).replace(/%(?=[0-9a-fA-F]{2})/g, "%25"))
      .join("/")
  );
}
