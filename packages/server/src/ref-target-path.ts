import { dirname, relative } from "node:path";

/**
 * Percent-encode one path segment as a URI-reference path segment (RFC 3986), leaving only the
 * unreserved characters (`A-Z a-z 0-9 - _ . ~`) literal. `encodeURIComponent` already covers most
 * reserved/unsafe characters (including `#` and `%` themselves), but it deliberately leaves
 * `! ' ( ) *` unescaped for legacy reasons — those are additionally encoded here so a segment can
 * never smuggle a raw quote character into a generated reference that later gets wrapped in a
 * single-quoted YAML scalar or double-quoted JSON string.
 */
function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Format `toPath` as a relative `$ref`-style file reference from the directory of `fromPath`. Each
 * path segment is percent-encoded as a URI reference (issue #121) so a filename containing `#`
 * (which would otherwise be mistaken for the fragment delimiter), `%`, spaces, quotes, or non-ASCII
 * characters produces a reference that resolves back to the intended file instead of a broken one.
 */
export function relativeRefPath(fromPath: string, toPath: string): string {
  const rel = relative(dirname(fromPath), toPath).split(/\\/).join("/");
  const encoded = rel.split("/").map(encodePathSegment).join("/");
  if (encoded.startsWith(".")) return encoded;
  return `./${encoded}`;
}
