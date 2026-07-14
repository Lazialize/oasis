import { readFile as fsReadFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
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
   * to) is recognised as the same file. Must be idempotent and agree with `resolve`'s output.
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

/** Resolve a native path relative to the directory containing `fromPath`. */
function resolvePath(fromPath: string, ref: string): string {
  if (isAbsolute(ref)) return pathResolve(ref);
  return pathResolve(dirname(fromPath), ref);
}

export class NodeFileSystem implements FileSystem {
  async readFile(path: string): Promise<string> {
    return fsReadFile(path, "utf-8");
  }

  resolve(fromPath: string, ref: string): string {
    return resolvePath(fromPath, ref);
  }

  canonicalize(path: string): string {
    return pathResolve(path);
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
