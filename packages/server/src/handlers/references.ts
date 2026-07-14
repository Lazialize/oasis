import type { Position, Range } from "@oasis/core";
import { componentKeyRange, resolveComponentTarget } from "../component-target.ts";
import { collectComponentReferences } from "../component-references.ts";
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
  // so a ref in a file shared by two graphs is reported once. `collectComponentReferences` is the
  // single reference index shared with rename: `$ref`s (including nested pointers and URI-style
  // discriminator mappings) plus name-based references (Security Requirement keys, bare
  // discriminator names).
  const results: ReferenceLocation[] = [];
  for (const ref of collectComponentReferences(target, await referringDocumentsFor(ctx, target.doc.filePath))) {
    results.push({ filePath: ref.filePath, range: ref.locationRange });
  }

  if (params.includeDeclaration) {
    const keyRange = componentKeyRange(target.doc, target);
    if (keyRange) results.push({ filePath: target.doc.filePath, range: keyRange });
  }

  return results;
}
