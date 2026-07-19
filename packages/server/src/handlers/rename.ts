import { formatPointer, nodeAtPointer } from "@oasis/core";
import type { Position, Range } from "@oasis/core";
import { componentKeyRange, componentNameSegmentRange, nameBasedRefAtPosition, resolveComponentTarget } from "../component-target.ts";
import { collectComponentReferences, encodeComponentName } from "../component-references.ts";
import { findRefAtPosition } from "../refs.ts";
import { mapKeys } from "../yaml-helpers.ts";
import { referringDocumentsFor, resolveDocContext } from "../workspace.ts";
import type { ServerContext } from "../workspace.ts";

export interface RenamePositionParams {
  path: string;
  position: Position;
}

export interface PrepareRenameResult {
  range: Range;
  placeholder: string;
}

/**
 * The OpenAPI component-key grammar Oasis accepts for a rename: at least one character, all from
 * `[A-Za-z0-9._-]`. This deliberately rejects anything that would need escaping or quoting in a
 * `$ref`/JSON Pointer (`/`, `#`, `~`), or that would corrupt the definition's YAML when written as a
 * mapping key (spaces, colons, quotes, non-ASCII, ...). Names inside this grammar can always be
 * inserted into a `$ref` string unescaped and into a mapping key/value with at most simple quoting.
 */
const VALID_NAME_RE = /^[A-Za-z0-9._-]+$/;

function isValidComponentName(name: string): boolean {
  return VALID_NAME_RE.test(name);
}

/**
 * Whether `params.position` sits on a renameable component (its definition key, its subtree, a
 * `$ref` pointing at it, or a name-based reference — a Security Requirement key or a bare
 * discriminator mapping name), and if so, the exact range to highlight and the current name as
 * placeholder. Returns undefined for any other position, so the editor blocks F2 there.
 */
export async function prepareRename(ctx: ServerContext, params: RenamePositionParams): Promise<PrepareRenameResult | undefined> {
  const docCtx = await resolveDocContext(ctx, params.path);
  if (!docCtx) return undefined;
  const { graph, doc } = docCtx;

  const target = resolveComponentTarget(graph, doc, params.position);
  if (!target) return undefined;

  const refAt = findRefAtPosition(graph, doc, params.position);
  if (refAt) {
    const range = componentNameSegmentRange(doc, refAt.range, target.section, target.name);
    if (!range) return undefined;
    return { range, placeholder: target.name };
  }

  // Cursor on a name-based reference: highlight the referencing token itself, not the definition.
  const nameBased = nameBasedRefAtPosition(doc, params.position);
  if (nameBased) return { range: nameBased.range, placeholder: target.name };

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
 * Rename a component: the definition key edit, plus every reference across the graph — `$ref`
 * component-name segments (including nested pointers under the component), Security Requirement
 * keys, and discriminator mapping names (bare or URI-style, each preserving its original form).
 * Rejects (returns undefined) names outside the accepted component-key grammar and name collisions
 * within the same component section of the definition's document.
 */
export async function renameComponent(ctx: ServerContext, params: RenameParams): Promise<RenameEdit[] | undefined> {
  const docCtx = await resolveDocContext(ctx, params.path);
  if (!docCtx) return undefined;
  const { graph, doc } = docCtx;

  const target = resolveComponentTarget(graph, doc, params.position);
  if (!target) return undefined;

  if (!isValidComponentName(params.newName)) return undefined;

  const sectionNode = nodeAtPointer(target.doc, formatPointer(["components", target.section]))?.node;
  const existingNames = mapKeys(sectionNode).filter((n) => n !== target.name);
  if (existingNames.includes(params.newName)) return undefined;

  const keyRange = componentKeyRange(target.doc, target);
  if (!keyRange) return undefined;

  // The definition key is written as a mapping key, so it's encoded for its document's syntax
  // (JSON string, or single-quoted YAML when the name would otherwise be reinterpreted).
  const edits: RenameEdit[] = [
    { filePath: target.doc.filePath, range: keyRange, newText: encodeComponentName(params.newName, target.doc.filePath) },
  ];

  // Scan every graph that loads the definition's file, not just the owning entry's: the same
  // component can be referenced from a sibling entry's graph (e.g. two config `entries` that both
  // reference a shared file). `referringDocumentsFor` dedupes documents by path, so a file shared by
  // two graphs — and any reference it holds — is edited exactly once. `collectComponentReferences`
  // is the single reference index shared with find-references: it covers `$ref`s (including nested
  // pointers and URI-style discriminator mappings) plus name-based references (Security Requirement
  // keys, bare discriminator names).
  for (const ref of collectComponentReferences(target, await referringDocumentsFor(ctx, target.doc.filePath))) {
    // A `$ref` pointer segment sits inside an existing string literal, so the bare name is inserted;
    // a bare mapping key/value is re-encoded for its document's syntax.
    const newText = ref.context === "pointer-segment" ? params.newName : encodeComponentName(params.newName, ref.filePath);
    edits.push({ filePath: ref.filePath, range: ref.nameRange, newText });
  }

  return edits;
}
