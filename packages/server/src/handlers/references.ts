import { findRefs, resolveRef } from "@oasis/core";
import type { Position, Range } from "@oasis/core";
import { componentKeyRange, resolveComponentTarget } from "../component-target.ts";
import { getDocument, getGraph, resolveEntryForPath } from "../workspace.ts";
import type { ServerContext } from "../workspace.ts";

export interface ReferencesParams {
  path: string;
  position: Position;
  includeDeclaration: boolean;
}

export interface ReferenceLocation {
  filePath: string;
  range: Range;
}

/**
 * Cursor on a component definition (key, or anywhere in its subtree) or on a `$ref` pointing at
 * one -> every `$ref` location across the owning workspace graph that resolves to that component,
 * plus (when `includeDeclaration`) the component's own key range.
 */
export async function getReferences(ctx: ServerContext, params: ReferencesParams): Promise<ReferenceLocation[]> {
  const entryPath = await resolveEntryForPath(ctx, params.path);
  const graph = await getGraph(ctx, entryPath);
  const doc = getDocument(graph, params.path);
  if (!doc) return [];

  const target = resolveComponentTarget(graph, doc, params.position);
  if (!target) return [];

  const results: ReferenceLocation[] = [];
  for (const fileDoc of graph.documents.values()) {
    for (const ref of findRefs(fileDoc)) {
      const resolved = resolveRef(graph, fileDoc, ref.value);
      if (!resolved.ok) continue;
      if (resolved.doc.filePath === target.doc.filePath && resolved.pointer === target.pointer) {
        results.push({ filePath: fileDoc.filePath, range: ref.range });
      }
    }
  }

  if (params.includeDeclaration) {
    const keyRange = componentKeyRange(target.doc, target);
    if (keyRange) results.push({ filePath: target.doc.filePath, range: keyRange });
  }

  return results;
}
