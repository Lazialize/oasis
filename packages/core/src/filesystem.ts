import { realpathSync } from "node:fs";
import { readFile as fsReadFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { safeDecodeURIComponent } from "./pointer.ts";
import { uriScheme } from "./uri.ts";

/**
 * Abstraction over file access so core can be fed either real files (CLI, linter, bundler)
 * or in-memory buffers (LSP unsaved documents, tests).
 */
export interface FileSystem {
  readFile(path: string): string | Promise<string>;
  /** Resolve a native path relative to the directory containing `fromPath` into an absolute path. */
  resolve(fromPath: string, ref: string): string;
  /**
   * Reduce `path` to the single canonical identity this file system uses to key a document, so a
   * path reached two different ways (e.g. a relative entry vs. the absolute path a `$ref` resolves
   * to, or — for `NodeFileSystem` — a symlinked alias vs. its real path, or a case alias on a
   * case-insensitive filesystem) is recognised as the same file. Must be idempotent and agree with
   * `resolve`'s output. A path that does not exist (yet) still canonicalizes deterministically,
   * lexically, so failed loads dedupe too.
   *
   * This value doubles as the display path used in diagnostics and editor locations (`filePath` on
   * a parsed document): deliberately so, matching the existing precedent of canonicalizing a
   * relative entry path before display (issue #25). Callers that reach the same physical file
   * through different spellings will therefore see whichever spelling canonicalize normalizes to
   * (e.g. the real, on-disk-cased path for `NodeFileSystem`), not the one they originally typed.
   */
  canonicalize(path: string): string;
}

/**
 * Resolve a raw URI-reference file part through a FileSystem. Classification deliberately happens
 * before percent-decoding: `foo%3Abar.yaml` is a relative filename, not an unsupported `foo:` URI.
 * Invalid file URLs remain unchanged so loading reports an ordinary unresolved-reference
 * diagnostic instead of throwing from core.
 */
export function resolveFileReference(fs: FileSystem, fromPath: string, rawFilePart: string): string {
  const scheme = uriScheme(rawFilePart);
  if (scheme === undefined) return fs.resolve(fromPath, safeDecodeURIComponent(rawFilePart));
  if (scheme !== "file") return fs.resolve(fromPath, rawFilePart);
  try {
    return fs.resolve(fromPath, fileURLToPath(rawFilePart));
  } catch {
    return fs.resolve(fromPath, rawFilePart);
  }
}

/**
 * Canonicalize a `file:` resource URI to the identity `fs.canonicalize` assigns its path, so a
 * resource reached via a symlinked/case-aliased spelling is recognised as the same resource that
 * was indexed under its physical path (e.g. by `loadWorkspaceGraph`). Non-file URIs (`https:`,
 * `urn:`, ...) and unparsable `file:` URIs are returned unchanged.
 */
export function canonicalizeResourceUri(fs: FileSystem, uri: string): string {
  if (uriScheme(uri) !== "file") return uri;
  try {
    return pathToFileURL(fs.canonicalize(fileURLToPath(uri))).href;
  } catch {
    return uri;
  }
}

/** Resolve a native path relative to the directory containing `fromPath`. */
function resolvePath(fromPath: string, ref: string): string {
  if (isAbsolute(ref)) return pathResolve(ref);
  return pathResolve(dirname(fromPath), ref);
}

export class NodeFileSystem implements FileSystem {
  // Real filesystem access to resolve symlinks/on-disk casing is synchronous (canonicalize is a
  // sync method) and happens on every `$ref` target lookup, so results are memoized per instance
  // to keep the hot path to one syscall per distinct lexical path rather than one per lookup.
  private readonly canonicalCache = new Map<string, string>();

  async readFile(path: string): Promise<string> {
    return fsReadFile(path, "utf-8");
  }

  resolve(fromPath: string, ref: string): string {
    return resolvePath(fromPath, ref);
  }

  canonicalize(path: string): string {
    const lexical = pathResolve(path);
    const cached = this.canonicalCache.get(lexical);
    if (cached !== undefined) return cached;
    const physical = this.resolvePhysical(lexical);
    this.canonicalCache.set(lexical, physical);
    return physical;
  }

  // realpath recovers the physical identity: it follows symlinks and, on case-insensitive
  // filesystems (default macOS/Windows), the on-disk casing. A leaf that doesn't exist yet (or no
  // longer does) can't be resolved this way, so it falls back to canonicalizing its parent
  // directory and re-appending the (still lexical) leaf name — so a missing file reached through an
  // existing symlinked/differently-cased ancestor still gets one deterministic identity, and a
  // wholly nonexistent path bottoms out at its plain lexical form.
  private resolvePhysical(lexical: string): string {
    try {
      return realpathSync.native(lexical);
    } catch {
      const parent = dirname(lexical);
      if (parent === lexical) return lexical;
      return join(this.canonicalize(parent), basename(lexical));
    }
  }
}

export class InMemoryFileSystem implements FileSystem {
  private readonly files: Map<string, string>;

  constructor(files: Record<string, string> = {}) {
    this.files = new Map(Object.entries(files).map(([path, content]) => [pathResolve(path), content]));
  }

  readFile(path: string): string {
    const normalized = pathResolve(path);
    const content = this.files.get(normalized);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  writeFile(path: string, content: string): void {
    this.files.set(pathResolve(path), content);
  }

  deleteFile(path: string): void {
    this.files.delete(pathResolve(path));
  }

  has(path: string): boolean {
    return this.files.has(pathResolve(path));
  }

  resolve(fromPath: string, ref: string): string {
    return resolvePath(fromPath, ref);
  }

  canonicalize(path: string): string {
    return pathResolve(path);
  }
}
