/**
 * RFC 3986-aware classification of `$ref` / reference strings. `$ref` values are URI-references,
 * and OpenAPI 3.1 Schema Objects follow JSON Schema 2020-12 reference semantics where a reference
 * may be an absolute URI (`https:`, `urn:`), a relative path reference, or a fragment-only
 * reference. The workspace graph and resolver need to tell these apart so that only path references
 * are routed through the `FileSystem` abstraction; absolute non-filesystem URIs must not be turned
 * into bogus file lookups.
 */

/** URI schemes that name a real filesystem location and may therefore be mapped through `FileSystem`. */
export const FILESYSTEM_URI_SCHEMES = new Set<string>(["file"]);

/**
 * The scheme of a URI-reference, lowercased, or `undefined` when the reference has no scheme (a
 * relative or fragment-only reference). Per RFC 3986 a scheme is `ALPHA *( ALPHA / DIGIT / "+" /
 * "-" / "." )` followed by `:`. A single-letter "scheme" is deliberately rejected so a Windows
 * drive path (`C:\shared\pet.yaml`) is treated as a relative filesystem path, not a `c:` URI.
 */
export function uriScheme(ref: string): string | undefined {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]+):/.exec(ref);
  return match ? match[1]!.toLowerCase() : undefined;
}

export type UriReferenceKind = "fragment" | "relative" | "absolute";

/**
 * Classify a URI-reference into the three shapes the resolver cares about:
 * - `fragment`: a fragment-only reference (`#/components/...` or a plain-name `#anchor`), resolved
 *   within the current document.
 * - `absolute`: a reference carrying a URI scheme (`https://…`, `urn:…`, `file:…`).
 * - `relative`: everything else — a relative path reference (`./shared.yaml`, `../x.yaml#/y`).
 */
export function classifyUriReference(ref: string): UriReferenceKind {
  if (ref.startsWith("#")) return "fragment";
  if (uriScheme(ref) !== undefined) return "absolute";
  return "relative";
}

/**
 * Whether `ref` is an absolute URI-reference whose scheme is NOT a filesystem scheme — i.e. an
 * external target (`https:`, `urn:`, …) that the `FileSystem` abstraction cannot and must not try
 * to load. Fragment-only and relative path references (and `file:` URIs) are not external.
 */
export function isExternalUriReference(ref: string): boolean {
  const scheme = uriScheme(ref);
  return scheme !== undefined && !FILESYSTEM_URI_SCHEMES.has(scheme);
}
