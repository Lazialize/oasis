import { findRefs, parseRefString, rangeFromOffsets } from "@oasis/core";
import type { OasisDocument, Range } from "@oasis/core";
import { getDocument, getGraph, resolveEntryForPath } from "../workspace.ts";
import type { ServerContext } from "../workspace.ts";

export interface DocumentLinkParams {
  path: string;
}

export interface DocumentLinkResult {
  /** Range covering only the file-path portion of the `$ref` value (no quotes, no `#/...` fragment). */
  range: Range;
  /** Absolute path of the link's resolved target file. */
  targetPath: string;
}

const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;

/**
 * Every `$ref` in the document whose value has a file-path portion -> a clickable link to that
 * file. Same-document refs (`#/...`, no file part) are skipped: definition/hover already serve
 * them, and a link to the current file is noise. URL refs (`https://...`) are skipped too, since
 * they aren't local files the editor can navigate to as a document link.
 *
 * The target file is not checked for existence: an unresolvable relative path still gets a link,
 * so the editor's own "file not found" affordance applies rather than the link silently
 * disappearing (consistent with how definition/hover degrade for unresolved refs elsewhere).
 */
export async function getDocumentLinks(ctx: ServerContext, params: DocumentLinkParams): Promise<DocumentLinkResult[]> {
  const entryPath = await resolveEntryForPath(ctx, params.path);
  const graph = await getGraph(ctx, entryPath);
  const doc = getDocument(graph, params.path);
  if (!doc) return [];

  const results: DocumentLinkResult[] = [];
  for (const ref of findRefs(doc)) {
    const { filePart } = parseRefString(ref.value);
    if (filePart === "" || URL_SCHEME_RE.test(filePart)) continue;

    const range = filePartRange(doc, ref.range, filePart);
    if (!range) continue;

    results.push({ range, targetPath: graph.fileSystem.resolve(doc.filePath, filePart) });
  }
  return results;
}

/**
 * Locate the file-path portion's own range within the raw source, inside the scalar's full
 * (quote-inclusive) range. `filePart` is assumed to appear verbatim right after any opening quote
 * (true for plain/single/double-quoted YAML scalars as long as the path itself needs no escaping,
 * which holds for ordinary relative file paths).
 */
function filePartRange(doc: OasisDocument, scalarRange: Range, filePart: string): Range | undefined {
  const raw = doc.text.slice(scalarRange.startOffset, scalarRange.endOffset);
  const quoteChar = raw[0] === "'" || raw[0] === '"' ? raw[0] : undefined;
  const valueStart = scalarRange.startOffset + (quoteChar ? 1 : 0);
  const valueEnd = valueStart + filePart.length;
  if (valueEnd > scalarRange.endOffset) return undefined;
  return rangeFromOffsets(doc.filePath, doc.lineCounter, valueStart, valueEnd);
}
