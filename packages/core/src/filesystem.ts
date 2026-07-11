import { readFile as fsReadFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as pathResolve } from "node:path";

/**
 * Abstraction over file access so core can be fed either real files (CLI, linter, bundler)
 * or in-memory buffers (LSP unsaved documents, tests).
 */
export interface FileSystem {
  readFile(path: string): string | Promise<string>;
  /** Resolve `ref` relative to the directory containing `fromPath` into an absolute path. */
  resolve(fromPath: string, ref: string): string;
}

export class NodeFileSystem implements FileSystem {
  async readFile(path: string): Promise<string> {
    return fsReadFile(path, "utf-8");
  }

  resolve(fromPath: string, ref: string): string {
    if (isAbsolute(ref)) return pathResolve(ref);
    return pathResolve(dirname(fromPath), ref);
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
    if (isAbsolute(ref)) return pathResolve(ref);
    return pathResolve(dirname(fromPath), ref);
  }
}
