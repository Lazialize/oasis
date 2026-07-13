import type { Position, Range } from "@oasis/core";
import { resolveRefAtPosition } from "../refs.ts";
import { resolveDocContext } from "../workspace.ts";
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
  const docCtx = await resolveDocContext(ctx, params.path);
  if (!docCtx) return undefined;

  const result = resolveRefAtPosition(docCtx.graph, docCtx.doc, params.position);
  if (!result) return undefined;

  return { targetPath: result.doc.filePath, range: result.range };
}
