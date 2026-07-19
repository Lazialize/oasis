import { resolve as pathResolve, sep } from "node:path";
import type { FileSystem } from "@oasis/core";
import { URI } from "vscode-uri";

/**
 * Bidirectional mapping between the canonical filesystem-style paths the workspace graph keys
 * documents by and the original LSP document URIs (issue #115).
 *
 * Every other scheme (`untitled:`, `vscode-remote:`, ...) has no meaningful filesystem path —
 * collapsing it to `URI.parse(uri).fsPath` loses the scheme/authority (and, for `untitled:`,
 * yields a relative `Untitled-1` that reconstructs to the wrong `file:///Untitled-1`), so the open
 * buffer is never found in the overlay and diagnostics land on a synthetic URI. Instead each such
 * URI is assigned a stable synthetic path and remembered here, so overlay lookups hit the open
 * buffer and every response/diagnostic is reported back on the exact original URI.
 *
 * A `file:` URI's path is canonicalized (issue #153) so it agrees with the physical identity
 * `loadWorkspaceGraph` keys documents by — otherwise a document opened through a
 * symlinked/case-aliased path would never be found in the graph and every LSP feature for it would
 * silently do nothing. When canonicalization changes the path (i.e. the URI was reached through
 * such an alias), the original URI is remembered the same way a non-`file:` URI is, so `toUri`
 * still echoes back the *exact* URI the client opened — an editor keys its own open buffers by that
 * literal URI, and publishing diagnostics or edits against a different (if equivalent) `file:` URI
 * would silently fail to land on the open buffer.
 */
export interface UriPathMapper {
  /** Canonical internal path for a document URI: the `FileSystem`-canonicalized path for `file:`
   * URIs (remembered so `toUri` can recover the exact original URI if that differs from the
   * literal path); every other scheme is assigned a stable synthetic path, remembered the same
   * way. */
  toPath(uri: string): string;
  /** Original document URI for an internal path: the remembered URI, when the path required one
   * (a synthetic path, or a `file:` URI whose canonicalized path differs from its literal one),
   * otherwise the `file:` URI reconstructed directly from the path. */
  toUri(path: string): string;
  /** Forget a URI's remembered mapping (e.g. when its document closes) so mappings don't
   * accumulate for the lifetime of the server. No-op for a URI that was never remembered (an
   * ordinary `file:` URI whose path canonicalizes to itself). */
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

/**
 * `fs`'s `canonicalize`, when given, is used to derive the path for a `file:` URI instead of its
 * raw `fsPath` (see the physical-identity note on `UriPathMapper` above). Omit `fs` for tests that
 * don't care about physical-identity edge cases.
 */
export function createUriPathMapper(fs?: Pick<FileSystem, "canonicalize">): UriPathMapper {
  const remembered = new Map<string, string>();

  return {
    toPath(uri) {
      const parsed = URI.parse(uri);
      if (parsed.scheme === "file") {
        const path = fs ? fs.canonicalize(parsed.fsPath) : parsed.fsPath;
        // Only remember when canonicalization actually changed the path: the common case (no
        // symlink/case alias involved) needs no entry, keeping the map limited to the aliased
        // documents that actually need it.
        if (path !== parsed.fsPath) remembered.set(path, uri);
        return path;
      }
      const path = syntheticPath(uri);
      remembered.set(path, uri);
      return path;
    },
    toUri(path) {
      return remembered.get(path) ?? URI.file(path).toString();
    },
    forget(uri) {
      const parsed = URI.parse(uri);
      if (parsed.scheme === "file") {
        const path = fs ? fs.canonicalize(parsed.fsPath) : parsed.fsPath;
        if (path !== parsed.fsPath) remembered.delete(path);
        return;
      }
      remembered.delete(syntheticPath(uri));
    },
  };
}
