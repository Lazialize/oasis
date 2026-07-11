import { findRefs, formatPointer, nodeAtPointer, resolveRef } from "@oasis/core";
import type { Position, Range } from "@oasis/core";
import { componentKeyRange, refSegmentRange, resolveComponentTarget } from "../component-target.ts";
import { findRefAtPosition } from "../refs.ts";
import { mapKeys } from "../yaml-helpers.ts";
import { getDocument, getGraph, resolveEntryForPath } from "../workspace.ts";
import type { ServerContext } from "../workspace.ts";

export interface RenamePositionParams {
  path: string;
  position: Position;
}

export interface PrepareRenameResult {
  range: Range;
  placeholder: string;
}

/** Characters that would make a component name invalid as a JSON Pointer / `$ref` segment. */
const INVALID_NAME_RE = /[/#~]/;

function isValidComponentName(name: string): boolean {
  return name.length > 0 && !INVALID_NAME_RE.test(name);
}

/**
 * Whether `params.position` sits on a renameable component (its definition key, its subtree, or a
 * `$ref` pointing at it), and if so, the exact range to highlight and the current name as
 * placeholder. Returns undefined for any other position, so the editor blocks F2 there.
 */
export async function prepareRename(ctx: ServerContext, params: RenamePositionParams): Promise<PrepareRenameResult | undefined> {
  const entryPath = await resolveEntryForPath(ctx, params.path);
  const graph = await getGraph(ctx, entryPath);
  const doc = getDocument(graph, params.path);
  if (!doc) return undefined;

  const target = resolveComponentTarget(graph, doc, params.position);
  if (!target) return undefined;

  const refAt = findRefAtPosition(doc, params.position);
  if (refAt) {
    const range = refSegmentRange(doc, refAt.range, target.name);
    if (!range) return undefined;
    return { range, placeholder: target.name };
  }

  const range = componentKeyRange(target.doc, target);
  if (!range) return undefined;
  return { range, placeholder: target.name };
}

export interface RenameParams extends RenamePositionParams {
  newName: string;
}

export interface RenameEdit {
  filePath: string;
  range: Range;
  newText: string;
}

/**
 * Rename a component: the definition key edit, plus every referencing `$ref`'s final pointer
 * segment across the graph. Rejects (returns undefined) invalid new names and name collisions
 * within the same component section of the definition's document.
 */
export async function renameComponent(ctx: ServerContext, params: RenameParams): Promise<RenameEdit[] | undefined> {
  const entryPath = await resolveEntryForPath(ctx, params.path);
  const graph = await getGraph(ctx, entryPath);
  const doc = getDocument(graph, params.path);
  if (!doc) return undefined;

  const target = resolveComponentTarget(graph, doc, params.position);
  if (!target) return undefined;

  if (!isValidComponentName(params.newName)) return undefined;

  const sectionNode = nodeAtPointer(target.doc, formatPointer(["components", target.section]))?.node;
  const existingNames = mapKeys(sectionNode).filter((n) => n !== target.name);
  if (existingNames.includes(params.newName)) return undefined;

  const keyRange = componentKeyRange(target.doc, target);
  if (!keyRange) return undefined;

  const edits: RenameEdit[] = [{ filePath: target.doc.filePath, range: keyRange, newText: params.newName }];

  for (const fileDoc of graph.documents.values()) {
    for (const ref of findRefs(fileDoc)) {
      const resolved = resolveRef(graph, fileDoc, ref.value);
      if (!resolved.ok) continue;
      if (resolved.doc.filePath !== target.doc.filePath || resolved.pointer !== target.pointer) continue;
      const segRange = refSegmentRange(fileDoc, ref.range, target.name);
      if (!segRange) continue;
      edits.push({ filePath: fileDoc.filePath, range: segRange, newText: params.newName });
    }
  }

  return edits;
}
