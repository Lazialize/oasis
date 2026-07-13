import { findRefs, resolveRef } from "@oasis/core";
import type { Position, Range } from "@oasis/core";
import { componentKeyRange, resolveComponentTarget } from "../component-target.ts";
import { referringDocumentsFor, resolveDocContext } from "../workspace.ts";
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
  const docCtx = await resolveDocContext(ctx, params.path);
  if (!docCtx) return [];
  const { graph, doc } = docCtx;

  const target = resolveComponentTarget(graph, doc, params.position);
  if (!target) return [];

  // Scan every graph that loads the definition's file, not just the owning entry's, so refs living
  // in a sibling entry's graph are counted too. `referringDocumentsFor` dedupes documents by path,
  // so a ref in a file shared by two graphs is reported once.
  const results: ReferenceLocation[] = [];
  for (const { doc: fileDoc, graph: refGraph } of await referringDocumentsFor(ctx, target.doc.filePath)) {
    for (const ref of findRefs(fileDoc)) {
      const resolved = resolveRef(refGraph, fileDoc, ref.value);
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
