import type { OasisDocument, WorkspaceGraph } from "@oasis/core";
import type { LintDiagnostic } from "./types.ts";

/**
 * Documents from every *other* graph in `allGraphs` that aren't already in `graph`, deduped by file
 * path. Fed to the lint engine as `externalDocuments` so a whole-workspace rule
 * (`components/no-unused`) counts usage from sibling entries: a component in a shared file used only
 * by another entry must not be flagged unused when linting this graph. Returns an empty array when
 * `graph` is the only graph, keeping a single-entry lint identical to linting the graph alone.
 *
 * Pure (no I/O): both the CLI's multi-entry lint and the LSP's project-mode lint compute sibling
 * externals through this so their project-awareness can't drift.
 */
export function siblingExternalDocuments(graph: WorkspaceGraph, allGraphs: Iterable<WorkspaceGraph>): OasisDocument[] {
  const seen = new Set<string>(graph.documents.keys());
  const externals: OasisDocument[] = [];
  for (const other of allGraphs) {
    if (other === graph) continue;
    for (const doc of other.documents.values()) {
      if (seen.has(doc.filePath)) continue;
      seen.add(doc.filePath);
      externals.push(doc);
    }
  }
  return externals;
}

/**
 * Drop exact-duplicate diagnostics, keeping the first occurrence and preserving order. Two
 * diagnostics are duplicates only when their rule, severity, range, and message all match (mirrors
 * the LSP's `[code, severity, range, message]` merge key in `packages/server/src/validation.ts`).
 *
 * Used when concatenating the results of linting several entry graphs that share a file: the shared
 * file yields identical diagnostics from each entry, which would otherwise appear doubled.
 * Contextually different findings (e.g. messages that embed a different mounted path) differ in
 * their message and so are intentionally kept distinct.
 */
export function dedupeDiagnostics(diagnostics: Iterable<LintDiagnostic>): LintDiagnostic[] {
  const seen = new Set<string>();
  const result: LintDiagnostic[] = [];
  for (const d of diagnostics) {
    const key = JSON.stringify([d.rule, d.severity, d.range, d.message]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(d);
  }
  return result;
}
