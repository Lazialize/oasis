import type { FileSystem } from "./filesystem.ts";
import { type OasisDocument, parseDocument } from "./parse.ts";
import { zeroRange } from "./position.ts";
import { findRefs, parseRefString } from "./ref.ts";
import type { Diagnostic, Range } from "./types.ts";

export interface WorkspaceGraph {
  entryPath: string;
  /** All loaded documents, keyed by absolute path. */
  documents: Map<string, OasisDocument>;
  /** Graph-level diagnostics: load failures and $ref cycles. Per-document diagnostics live on
   * each OasisDocument (syntax errors, duplicate keys) and are not duplicated here. */
  diagnostics: Diagnostic[];
  fileSystem: FileSystem;
}

/**
 * Load an entry document and transitively follow every `$ref` that points at another file,
 * building a workspace graph. Never throws: missing files and reference cycles are recorded as
 * diagnostics on the returned graph.
 */
export async function loadWorkspaceGraph(fs: FileSystem, entryPath: string): Promise<WorkspaceGraph> {
  const documents = new Map<string, OasisDocument>();
  const diagnostics: Diagnostic[] = [];
  const visiting = new Set<string>();
  // Negative cache: a path that already failed to load is not re-read (or re-diagnosed) for
  // every additional `$ref` site pointing at it — one attempt, one diagnostic per file.
  const failed = new Set<string>();

  async function loadFile(path: string, viaRefRange?: Range): Promise<void> {
    if (documents.has(path) || failed.has(path)) return;
    visiting.add(path);

    let text: string;
    try {
      text = await fs.readFile(path);
    } catch (err) {
      failed.add(path);
      diagnostics.push({
        message: `Failed to load "${path}": ${err instanceof Error ? err.message : String(err)}`,
        severity: "error",
        code: "no-unresolved-ref",
        source: "core",
        range: viaRefRange ?? zeroRange(path),
      });
      visiting.delete(path);
      return;
    }

    const doc = parseDocument(text, path);
    documents.set(path, doc);

    for (const ref of findRefs(doc)) {
      const { filePart } = parseRefString(ref.value);
      if (filePart === "") continue; // same-document ref; no file to load

      const targetPath = fs.resolve(path, filePart);
      if (targetPath === path) continue;

      if (visiting.has(targetPath)) {
        diagnostics.push({
          message: `Circular reference detected: "${path}" -> "${targetPath}"`,
          severity: "warning",
          code: "no-ref-cycle",
          source: "core",
          range: ref.range,
        });
        continue;
      }

      await loadFile(targetPath, ref.range);
    }

    visiting.delete(path);
  }

  await loadFile(entryPath);

  return { entryPath, documents, diagnostics, fileSystem: fs };
}

/** All diagnostics in the graph: per-document parse diagnostics plus graph-level ones. */
export function allDiagnostics(graph: WorkspaceGraph): Diagnostic[] {
  const result: Diagnostic[] = [...graph.diagnostics];
  for (const doc of graph.documents.values()) {
    result.push(...doc.diagnostics);
  }
  return result;
}
