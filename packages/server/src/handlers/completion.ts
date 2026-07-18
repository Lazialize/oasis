import { isMap, isScalar } from "yaml";
import { detectVersion, formatPointer, nodeAtPointer, nodeAtPosition, offsetAtPosition, parsePointer } from "@oasis/core";
import type { OasisDocument, OpenApiVersion, Position, WorkspaceGraph } from "@oasis/core";
import { allowedKeys, classifyPointer, inferRootKind, KIND_TO_COMPONENT_SECTION } from "../keywords.ts";
import type { ObjectKind } from "../keywords.ts";
import { findRefValueEditContext, parentPointer } from "../refs.ts";
import { relativeRefPath } from "../ref-target-path.ts";
import { mapKeys } from "../yaml-helpers.ts";
import { indentationFallback } from "../indentation-fallback.ts";
import { isJsonDocument } from "../component-references.ts";
import { jsonKeyInsertionContext } from "../json-key-context.ts";
import { resolveDocContext } from "../workspace.ts";
import type { ServerContext } from "../workspace.ts";

/** The concrete surface syntax of a document, governing how keys and scalar values are encoded. */
export type DocumentSyntax = "yaml" | "json";

export type CompletionItemKind = "key" | "ref";

export interface CompletionTextEdit {
  range: { start: Position; end: Position };
  newText: string;
}

export interface CompletionItem {
  label: string;
  kind: CompletionItemKind;
  /** Plain insertion text, used when no `textEdit` (and hence no explicit replace range) applies. */
  insertText?: string;
  /** Replaces `range` with `newText` on accept — used whenever we know what's already been typed. */
  textEdit?: CompletionTextEdit;
  /** What the client should filter against; set explicitly for labels containing `/ # .` etc. that
   * would otherwise confuse the client's default word-boundary filtering. */
  filterText?: string;
}

export interface CompletionParams {
  path: string;
  position: Position;
}

/**
 * Editing context for a key completion, describing where the accepted key is written.
 * - YAML: `replaceRange`, when given, covers a prefix already typed on the line (e.g. a
 *   partially-typed key) so accepting the completion replaces it rather than inserting alongside it.
 * - JSON: `replaceRange` is the (zero-width) insertion point, and `leadingComma` requests a comma to
 *   separate the new member from a preceding sibling. JSON keys are only offered with a context —
 *   without one there is no safe way to emit a valid edit.
 */
export interface KeyEditContext {
  replaceRange: { start: Position; end: Position };
  leadingComma?: boolean;
}

/**
 * Keys valid on the object living at `pointer`, for `version`, minus keys already present, encoded
 * for `syntax`. YAML keys are written `key: `; JSON keys are double-quoted and escaped (`"key": `),
 * with a leading comma when the context requires separating from a preceding sibling. JSON key
 * completions are only produced when an `editContext` is supplied.
 */
export function keyCompletionsForPointer(
  pointer: string,
  version: OpenApiVersion,
  existingKeys: string[] = [],
  rootKind: ObjectKind = "root",
  syntax: DocumentSyntax = "yaml",
  editContext?: KeyEditContext,
): CompletionItem[] {
  const kind = classifyPointer(pointer, rootKind);
  if (!kind) return [];
  if (syntax === "json" && !editContext) return [];
  const existing = new Set(existingKeys);
  return allowedKeys(kind, version)
    .filter((key) => !existing.has(key))
    .map((label) => {
      const newText =
        syntax === "json" ? `${editContext?.leadingComma ? "," : ""}${JSON.stringify(label)}: ` : `${label}: `;
      const item: CompletionItem = { label, kind: "key", insertText: newText };
      if (editContext) item.textEdit = { range: editContext.replaceRange, newText };
      return item;
    });
}

/**
 * `$ref` target suggestions for a `$ref` living at `refPointer`: every component of the section
 * appropriate to the containing object, from every document in the workspace graph. Same-file
 * targets are formatted as `#/components/...`; cross-file targets as `./relative/path#/components/...`.
 * `editContext`, when given, describes what's already been typed as the (possibly quoted, possibly
 * partial) `$ref` value, so each item gets a `textEdit` replacing exactly that text.
 */
export function refCompletionsForPointer(
  fromDoc: OasisDocument,
  graph: WorkspaceGraph,
  refPointer: string,
  rootKind: ObjectKind = "root",
  editContext?: { quoteChar: "'" | '"' | undefined; hasClosingQuote: boolean; replaceRange: { start: Position; end: Position } },
  syntax: DocumentSyntax = "yaml",
): CompletionItem[] {
  const containerPointer = refPointer.endsWith("/$ref") ? refPointer.slice(0, -"/$ref".length) : refPointer;
  const kind = classifyPointer(containerPointer, rootKind);
  const section = kind ? KIND_TO_COMPONENT_SECTION[kind] : undefined;
  if (!section) return [];

  const items: CompletionItem[] = [];
  for (const [path, targetDoc] of graph.documents) {
    const componentsNode = nodeAtPointer(targetDoc, `/components/${section}`)?.node;
    for (const name of mapKeys(componentsNode)) {
      const label =
        path === fromDoc.filePath
          ? `#/components/${section}/${name}`
          : `${relativeRefPath(fromDoc.filePath, path)}#/components/${section}/${name}`;
      // With no quote typed yet, supply the surrounding quotes ourselves: JSON requires double
      // quotes and escaping; YAML single-quotes the pointer (which contains no `'`). When a quote is
      // already present, replace only the value text, closing the quote if the user hasn't.
      const emptyValue = syntax === "json" ? JSON.stringify(label) : `'${label}'`;
      const insertText = syntax === "json" ? JSON.stringify(label) : label;
      const item: CompletionItem = { label, kind: "ref", insertText, filterText: label };
      if (editContext) {
        const { quoteChar, hasClosingQuote, replaceRange } = editContext;
        const newText = quoteChar === undefined ? emptyValue : hasClosingQuote ? label : `${label}${quoteChar}`;
        item.textEdit = { range: replaceRange, newText };
      }
      items.push(item);
    }
  }
  return items;
}

/** Dispatches to `$ref` completion or key completion based on what's under the cursor. */
export async function getCompletions(ctx: ServerContext, params: CompletionParams): Promise<CompletionItem[]> {
  const docCtx = await resolveDocContext(ctx, params.path);
  if (!docCtx) return [];
  const { graph, doc } = docCtx;

  // Fragment files (e.g. a Path Item file with no top-level `openapi:` key) don't carry their own
  // version; fall back to the owning entry document's version.
  const version = detectVersion(doc) ?? detectVersion(graph.documents.get(graph.entryPath) ?? doc) ?? "3.1";
  const rootKind = inferRootKind(doc, graph);
  const syntax: DocumentSyntax = isJsonDocument(doc.filePath) ? "json" : "yaml";
  const offset = offsetAtPosition(doc.lineCounter, params.position);
  const found = nodeAtPosition(doc, offset);

  // `$ref` value: prefer a raw-text description of what's typed so far (handles quotes the AST's
  // error recovery may have mangled), gated on the AST agreeing the cursor is on/near a `$ref`.
  if (found && isScalar(found.node) && (found.pointer.endsWith("/$ref") || found.pointer === "/$ref")) {
    const editContext = findRefValueEditContext(doc.text, params.position);
    return refCompletionsForPointer(doc, graph, found.pointer, rootKind, editContext, syntax);
  }
  const rawRefContext = findRefValueEditContext(doc.text, params.position);
  if (rawRefContext && found) {
    const containerPointer = isMap(found.node) ? found.pointer : parentPointer(found.pointer);
    return refCompletionsForPointer(doc, graph, `${containerPointer}/$ref`, rootKind, rawRefContext, syntax);
  }

  // Partially-typed (or empty) key line: derive the enclosing mapping from indentation, since the
  // AST node at this position is either missing or landed somewhere unhelpful (e.g. a YAML syntax
  // error upstream jumped parsing back to a shallower ancestor). This heuristic is YAML-specific
  // (significant indentation); JSON keys fall through to the AST-based container below.
  if (syntax === "yaml") {
    const fallback = indentationFallback(doc.text, params.position);
    if (fallback && classifyPointer(fallback.containerPointer, rootKind)) {
      const containerNode = nodeAtPointer(doc, fallback.containerPointer)?.node;
      const existingKeys = mapKeys(containerNode);
      return keyCompletionsForPointer(fallback.containerPointer, version, existingKeys, rootKind, syntax, {
        replaceRange: fallback.replaceRange,
      });
    }
  }

  if (!found) return [];

  const containerPointer = isMap(found.node) ? found.pointer : parentPointer(found.pointer);
  const containerNode = nodeAtPointer(doc, containerPointer)?.node;
  const existingKeys = mapKeys(containerNode);
  // In JSON, only offer a key edit when the cursor sits at a safe fresh-insertion point (so the edit
  // can be quoted and comma-separated correctly); otherwise offer nothing.
  const keyContext =
    syntax === "json" ? jsonKeyInsertionContext(doc.text, offset, params.position) : undefined;
  return keyCompletionsForPointer(containerPointer, version, existingKeys, rootKind, syntax, keyContext);
}

// Re-exported so callers can build pointers without importing @oasis/core directly.
export { formatPointer, parsePointer };
