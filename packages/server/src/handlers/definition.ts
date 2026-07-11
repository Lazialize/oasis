import { resolveRef } from "@oasis/core";
import type { Position, Range } from "@oasis/core";
import { findRefAtPosition } from "../refs.ts";
import { getDocument, getGraph } from "../workspace.ts";
import type { ServerContext } from "../workspace.ts";

export interface DefinitionParams {
  path: string;
  position: Position;
}

export interface DefinitionResult {
  targetPath: string;
  range: Range;
}

/** Cursor on a `$ref` (or ref-like string) -> the range of the thing it points to. */
export async function getDefinition(ctx: ServerContext, params: DefinitionParams): Promise<DefinitionResult | undefined> {
  const graph = await getGraph(ctx, params.path);
  const doc = getDocument(graph, params.path);
  if (!doc) return undefined;

  const found = findRefAtPosition(doc, params.position);
  if (!found) return undefined;

  const result = resolveRef(graph, doc, found.refString);
  if (!result.ok) return undefined;

  return { targetPath: result.doc.filePath, range: result.range };
}
