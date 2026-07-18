import { resolve as pathResolve, sep } from "node:path";
import { URI } from "vscode-uri";

/**
 * Bidirectional mapping between the canonical filesystem-style paths the workspace graph keys
 * documents by and the original LSP document URIs (issue #115).
 *
 * `file:` URIs convert deterministically to/from their `fsPath`, so they need no state. Every other
 * scheme (`untitled:`, `vscode-remote:`, ...) has no meaningful filesystem path — collapsing it to
 * `URI.parse(uri).fsPath` loses the scheme/authority (and, for `untitled:`, yields a relative
 * `Untitled-1` that reconstructs to the wrong `file:///Untitled-1`), so the open buffer is never
 * found in the overlay and diagnostics land on a synthetic URI. Instead each such URI is assigned a
 * stable synthetic path and remembered here, so overlay lookups hit the open buffer and every
 * response/diagnostic is reported back on the exact original URI.
 */
export interface UriPathMapper {
  /** Canonical internal path for a document URI. `file:` URIs map to their `fsPath` (unchanged
   * legacy behavior); every other scheme is assigned a stable synthetic path and remembered so
   * `toUri` can recover the exact original URI. */
  toPath(uri: string): string;
  /** Original document URI for an internal path: the remembered URI for a synthetic (non-`file:`)
   * path, otherwise the `file:` URI for a real filesystem path. */
  toUri(path: string): string;
  /** Forget a non-`file:` URI's mapping (e.g. when its document closes) so mappings don't
   * accumulate for the lifetime of the server. No-op for `file:` URIs, which are never stored. */
  forget(uri: string): void;
}

/** Directory namespace for synthetic paths standing in for non-`file:` document URIs, chosen so it
 * won't collide with real project files. */
const SYNTHETIC_ROOT = `${sep}__oasis-nonfile__`;

/** A stable, canonical (idempotent under `path.resolve`) synthetic path for a non-`file:` URI: a
 * single path segment under `SYNTHETIC_ROOT` that percent-encodes the whole URI so it contains no
 * separators and never collapses under `canonicalize`. */
function syntheticPath(uri: string): string {
  return pathResolve(SYNTHETIC_ROOT, encodeURIComponent(uri));
}

export function createUriPathMapper(): UriPathMapper {
  const bySyntheticPath = new Map<string, string>();

  return {
    toPath(uri) {
      const parsed = URI.parse(uri);
      if (parsed.scheme === "file") return parsed.fsPath;
      const path = syntheticPath(uri);
      bySyntheticPath.set(path, uri);
      return path;
    },
    toUri(path) {
      return bySyntheticPath.get(path) ?? URI.file(path).toString();
    },
    forget(uri) {
      if (URI.parse(uri).scheme === "file") return;
      bySyntheticPath.delete(syntheticPath(uri));
    },
  };
}
