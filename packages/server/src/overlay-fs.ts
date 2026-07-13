import { NodeFileSystem } from "@oasis/core";
import type { FileSystem } from "@oasis/core";

/**
 * A `FileSystem` that serves open-buffer content (unsaved edits) for known URIs/paths and falls
 * back to disk for everything else. This lets cross-file features (definition, hover, refs) see
 * the current in-editor state of files that are open, without requiring a save.
 */
export class OverlayFileSystem implements FileSystem {
  private readonly disk = new NodeFileSystem();

  constructor(private readonly getOpenContent: (path: string) => string | undefined) {}

  readFile(path: string): string | Promise<string> {
    const overlay = this.getOpenContent(path);
    if (overlay !== undefined) return overlay;
    return this.disk.readFile(path);
  }

  resolve(fromPath: string, ref: string): string {
    return this.disk.resolve(fromPath, ref);
  }

  canonicalize(path: string): string {
    return this.disk.canonicalize(path);
  }
}
