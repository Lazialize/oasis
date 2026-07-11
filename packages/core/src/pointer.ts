/** RFC 6901 JSON Pointer escaping/unescaping and (de)composition into segments. */

export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Split a JSON Pointer string (e.g. "/paths/~1users/get") into unescaped segments. */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  const raw = pointer.startsWith("/") ? pointer.slice(1) : pointer;
  if (raw === "") return [""];
  return raw.split("/").map(unescapePointerSegment);
}

/** Join unescaped segments back into a JSON Pointer string. */
export function formatPointer(segments: string[]): string {
  if (segments.length === 0) return "";
  return "/" + segments.map(escapePointerSegment).join("/");
}
