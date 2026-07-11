import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import {
  formatPointer,
  nodeAtPointer,
  nodeAtPosition,
  offsetAtPosition,
  parsePointer,
  positionAtOffset,
  rangeFromOffsets,
} from "@oasis/core";
import type { OasisDocument, Position, Range, WorkspaceGraph } from "@oasis/core";
import { COMPONENT_CATEGORIES, HTTP_METHODS, childAt, isRefObject, iterateOperations, iteratePathItems, resolveMaybeRef } from "@oasis/linter";
import { relativeRefPath } from "../ref-target-path.ts";
import { getDocument, getGraph, resolveEntryForPath } from "../workspace.ts";
import type { ServerContext } from "../workspace.ts";

/** A single-file text edit, matching the shape used by rename/references. */
export interface CodeActionFileEdit {
  filePath: string;
  range: Range;
  newText: string;
}

/** A lightweight mirror of the fields of an LSP `Diagnostic` this handler needs. */
export interface CodeActionDiagnosticInput {
  code?: string | number;
  message: string;
  range: { start: Position; end: Position };
}

export interface CodeActionsParams {
  path: string;
  /** Cursor position (or selection start) — used to find the diagnostics' anchor and to detect
   * an extract-to-component opportunity when no diagnostic is involved. */
  position: Position;
  /** The diagnostics the client reports as overlapping the requested range (`params.context.diagnostics`). */
  diagnostics: CodeActionDiagnosticInput[];
}

export interface CodeActionResult {
  title: string;
  kind: "quickfix" | "refactor.extract";
  edits: CodeActionFileEdit[];
  /** Index into `params.diagnostics`, when this action resolves one of them. */
  diagnosticIndex?: number;
  isPreferred?: boolean;
}

/** Documents this feature edits: YAML source only (see module doc at the bottom of this file). */
function isYamlDocument(doc: OasisDocument): boolean {
  return !/\.jsonc?$/i.test(doc.filePath);
}

function toRangeOffsets(doc: OasisDocument, range: { start: Position; end: Position }): { start: number; end: number } {
  return { start: offsetAtPosition(doc.lineCounter, range.start), end: offsetAtPosition(doc.lineCounter, range.end) };
}

function matchesNodeRange(node: Node, start: number, end: number): boolean {
  return !!node.range && node.range[0] === start && node.range[1] === end;
}

function indentAt(doc: OasisDocument, offset: number): string {
  return " ".repeat(positionAtOffset(doc.lineCounter, offset).character);
}

function columnAt(doc: OasisDocument, offset: number): number {
  return positionAtOffset(doc.lineCounter, offset).character;
}

/** Capitalize `raw` into a PascalCase-ish identifier fragment, stripping non-alphanumerics. */
function toPascal(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9]+(.)/g, (_m, c: string) => c.toUpperCase());
  const alnum = cleaned.replace(/[^a-zA-Z0-9]/g, "");
  if (alnum === "") return "";
  return alnum.charAt(0).toUpperCase() + alnum.slice(1);
}

/** Generate a camelCase operationId candidate from an HTTP method + path template, e.g.
 * `get` + `/pets/{petId}` -> `getPetsByPetId`. */
function generateOperationId(method: string, template: string): string {
  const segments = template.split("/").filter(Boolean);
  const parts = [method.toLowerCase()];
  for (const seg of segments) {
    const paramMatch = /^\{(.+)\}$/.exec(seg);
    if (paramMatch) parts.push(`By${toPascal(paramMatch[1]!)}`);
    else parts.push(toPascal(seg));
  }
  return parts.join("");
}

/** Disambiguate `candidate` against `used` with a numeric suffix (candidate, candidate2, candidate3, ...). */
function dedupeName(candidate: string, used: Set<string>): string {
  if (!used.has(candidate)) return candidate;
  let i = 2;
  while (used.has(`${candidate}${i}`)) i++;
  return `${candidate}${i}`;
}

function pathTemplateParams(template: string): string[] {
  const names: string[] = [];
  const re = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template))) {
    if (match[1]) names.push(match[1]);
  }
  return names;
}

function zeroWidthRange(doc: OasisDocument, offset: number): Range {
  return rangeFromOffsets(doc.filePath, doc.lineCounter, offset, offset);
}

// ---------------------------------------------------------------------------
// 1 & 2: Add operationId / Add description (insert as the operation's first key)
// ---------------------------------------------------------------------------

function buildInsertFirstKeyAction(
  doc: OasisDocument,
  opNode: Node,
  keyText: string,
  title: string,
  diagnosticIndex: number,
): CodeActionResult | undefined {
  if (!isMap(opNode) || opNode.items.length === 0) return undefined;
  const firstItem = opNode.items[0]!;
  if (!isNode(firstItem.key) || !firstItem.key.range) return undefined;
  const indent = indentAt(doc, firstItem.key.range[0]);
  const insertOffset = lineStartOffset(doc, firstItem.key.range[0]);
  return {
    title,
    kind: "quickfix",
    edits: [{ filePath: doc.filePath, range: zeroWidthRange(doc, insertOffset), newText: `${indent}${keyText}\n` }],
    diagnosticIndex,
    isPreferred: true,
  };
}

function buildAddOperationId(
  graph: WorkspaceGraph,
  entryDoc: OasisDocument,
  doc: OasisDocument,
  diag: CodeActionDiagnosticInput,
  index: number,
): CodeActionResult | undefined {
  if (!/is missing an operationId/.test(diag.message)) return undefined;
  const { start, end } = toRangeOffsets(doc, diag.range);
  const ops = iterateOperations(graph, entryDoc);
  const op = ops.find((o) => o.doc.filePath === doc.filePath && matchesNodeRange(o.node, start, end));
  if (!op) return undefined;

  const existingIds = new Set<string>();
  for (const o of ops) {
    const idNode = childAt(o.node, "operationId");
    if (isScalar(idNode) && typeof idNode.value === "string" && idNode.value !== "") existingIds.add(idNode.value);
  }
  const id = dedupeName(generateOperationId(op.method, op.pathItem.template), existingIds);

  return buildInsertFirstKeyAction(op.doc, op.node, `operationId: ${id}`, "Add operationId", index);
}

function buildAddDescription(
  graph: WorkspaceGraph,
  entryDoc: OasisDocument,
  doc: OasisDocument,
  diag: CodeActionDiagnosticInput,
  index: number,
): CodeActionResult | undefined {
  const { start, end } = toRangeOffsets(doc, diag.range);
  const op = iterateOperations(graph, entryDoc).find((o) => o.doc.filePath === doc.filePath && matchesNodeRange(o.node, start, end));
  if (!op) return undefined;
  return buildInsertFirstKeyAction(op.doc, op.node, "description: TODO", "Add description", index);
}

// ---------------------------------------------------------------------------
// 3: Add parameter definition (path-params-defined)
// ---------------------------------------------------------------------------

function buildParamItemLines(propColumn: number, name: string): string {
  const dashPad = " ".repeat(Math.max(propColumn - 2, 0));
  const propPad = " ".repeat(propColumn);
  return [`${dashPad}- name: ${name}`, `${propPad}in: path`, `${propPad}required: true`, `${propPad}schema:`, `${propPad}  type: string`].join(
    "\n",
  );
}

/** Names already declared `in: path` directly on `node`'s own `parameters` list (following $refs). */
function declaredPathParamNames(graph: WorkspaceGraph, doc: OasisDocument, node: Node): Set<string> {
  const names = new Set<string>();
  const parametersNode = childAt(node, "parameters");
  if (!parametersNode || !isSeq(parametersNode)) return names;
  for (const item of parametersNode.items) {
    if (!isNode(item)) continue;
    const resolved = resolveMaybeRef(graph, doc, item, "");
    if (!isMap(resolved.node)) continue;
    const inNode = childAt(resolved.node, "in");
    if (!isScalar(inNode) || inNode.value !== "path") continue;
    const nameNode = childAt(resolved.node, "name");
    if (isScalar(nameNode) && typeof nameNode.value === "string") names.add(nameNode.value);
  }
  return names;
}

function buildParamFix(
  graph: WorkspaceGraph,
  targetDoc: OasisDocument,
  targetNode: Node,
  template: string,
  diag: CodeActionDiagnosticInput,
  index: number,
): CodeActionResult | undefined {
  if (!isMap(targetNode)) return undefined;
  const match = /path template parameter "\{([^}]+)\}" has no matching "in: path" parameter definition/.exec(diag.message);
  if (!match) return undefined;
  const paramName = match[1]!;

  if (!pathTemplateParams(template).includes(paramName)) return undefined; // stale: template changed
  if (declaredPathParamNames(graph, targetDoc, targetNode).has(paramName)) return undefined; // stale: already fixed

  const parametersNode = childAt(targetNode, "parameters");

  if (parametersNode) {
    if (!isSeq(parametersNode)) return undefined;
    if (parametersNode.items.length > 0) {
      const lastItem = parametersNode.items[parametersNode.items.length - 1];
      if (!isNode(lastItem) || !lastItem.range) return undefined;
      const propColumn = columnAt(targetDoc, lastItem.range[0]);
      const block = buildParamItemLines(propColumn, paramName);
      const insertOffset = trimTrailingWhitespaceEnd(targetDoc.text, lastItem.range[0], lastItem.range[1]);
      return {
        title: "Add parameter definition",
        kind: "quickfix",
        edits: [{ filePath: targetDoc.filePath, range: zeroWidthRange(targetDoc, insertOffset), newText: `\n${block}` }],
        diagnosticIndex: index,
        isPreferred: true,
      };
    }
    // An explicitly empty `parameters: []` — insert the first item just past the opening bracket.
    if (!parametersNode.range) return undefined;
    const propColumn = columnAt(targetDoc, parametersNode.range[0]) + 2;
    const block = buildParamItemLines(propColumn, paramName);
    const insertOffset = parametersNode.range[0];
    return {
      title: "Add parameter definition",
      kind: "quickfix",
      edits: [{ filePath: targetDoc.filePath, range: zeroWidthRange(targetDoc, insertOffset), newText: `\n${block}\n${" ".repeat(Math.max(propColumn - 2, 0))}` }],
      diagnosticIndex: index,
      isPreferred: true,
    };
  }

  if (targetNode.items.length === 0) return undefined;
  const firstItem = targetNode.items[0]!;
  if (!isNode(firstItem.key) || !firstItem.key.range) return undefined;
  const keyIndent = columnAt(targetDoc, firstItem.key.range[0]);
  const insertOffset = lineStartOffset(targetDoc, firstItem.key.range[0]);
  const block = buildParamItemLines(keyIndent + 4, paramName);
  const text = `${" ".repeat(keyIndent)}parameters:\n${block}\n`;
  return {
    title: "Add parameter definition",
    kind: "quickfix",
    edits: [{ filePath: targetDoc.filePath, range: zeroWidthRange(targetDoc, insertOffset), newText: text }],
    diagnosticIndex: index,
    isPreferred: true,
  };
}

function buildAddPathParam(
  graph: WorkspaceGraph,
  entryDoc: OasisDocument,
  doc: OasisDocument,
  diag: CodeActionDiagnosticInput,
  index: number,
): CodeActionResult | undefined {
  const { start, end } = toRangeOffsets(doc, diag.range);

  for (const pathItem of iteratePathItems(graph, entryDoc)) {
    if (!isMap(pathItem.node)) continue;

    if (pathItem.doc.filePath === doc.filePath && matchesNodeRange(pathItem.node, start, end)) {
      return buildParamFix(graph, pathItem.doc, pathItem.node, pathItem.template, diag, index);
    }

    for (const method of HTTP_METHODS) {
      const opNode = childAt(pathItem.node, method);
      if (!opNode) continue;
      const resolved = resolveMaybeRef(graph, pathItem.doc, opNode, "");
      if (resolved.doc.filePath === doc.filePath && matchesNodeRange(resolved.node, start, end)) {
        return buildParamFix(graph, resolved.doc, resolved.node, pathItem.template, diag, index);
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 4: Remove unused component
// ---------------------------------------------------------------------------

function lineStartOffset(doc: OasisDocument, offset: number): number {
  const line = positionAtOffset(doc.lineCounter, offset).line;
  return doc.lineCounter.lineStarts[line] ?? 0;
}

function lineEndOffsetInclusive(doc: OasisDocument, offset: number): number {
  // A node's range[1] sometimes already lands exactly at the start of the following line (when
  // its last line ends cleanly); in that case there's no partial line left to consume.
  if (positionAtOffset(doc.lineCounter, offset).character === 0) return offset;
  const idx = doc.text.indexOf("\n", offset);
  return idx === -1 ? doc.text.length : idx + 1;
}

function buildRemoveUnusedComponent(doc: OasisDocument, diag: CodeActionDiagnosticInput, index: number): CodeActionResult | undefined {
  const { start, end } = toRangeOffsets(doc, diag.range);
  const root = doc.yamlDoc.contents;
  if (!isNode(root) || !isMap(root)) return undefined;
  const componentsNode = childAt(root, "components");
  if (!componentsNode || !isMap(componentsNode)) return undefined;

  for (const category of COMPONENT_CATEGORIES) {
    const categoryNode = childAt(componentsNode, category);
    if (!categoryNode || !isMap(categoryNode)) continue;

    for (const pair of categoryNode.items) {
      const value = pair.value;
      if (!isNode(value) || !value.range) continue;
      if (!matchesNodeRange(value, start, end)) continue;

      const keyNode = pair.key;
      if (!isNode(keyNode) || !keyNode.range) return undefined;

      const deleteStart = lineStartOffset(doc, keyNode.range[0]);
      const deleteEnd = lineEndOffsetInclusive(doc, value.range[1]);
      return {
        title: "Remove unused component",
        kind: "quickfix",
        edits: [{ filePath: doc.filePath, range: rangeFromOffsets(doc.filePath, doc.lineCounter, deleteStart, deleteEnd), newText: "" }],
        diagnosticIndex: index,
      };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 5: Extract inline schema to components (refactor.extract, no diagnostic)
// ---------------------------------------------------------------------------

/** A node's `range[1]` can extend past its own meaningful content into trailing whitespace it
 * doesn't "own" any sibling to stop at (notably: the last node in a document extends to EOF).
 * Trim that back so a replace-range doesn't eat a trailing newline it shouldn't. */
function trimTrailingWhitespaceEnd(text: string, start: number, end: number): number {
  let e = end;
  while (e > start && /\s/.test(text[e - 1]!)) e--;
  return e;
}

/** Re-indent a raw source slice from `oldBaseIndent` (the column its first line started at) to
 * `newBaseIndent`, leaving the first line's own leading whitespace untouched (the caller prepends
 * `newBaseIndent` spaces to it separately, since a block value's first line normally carries none). */
function reindentBlock(sliceText: string, oldBaseIndent: number, newBaseIndent: number): string {
  const delta = newBaseIndent - oldBaseIndent;
  const lines = sliceText.split("\n");
  return lines
    .map((line, i) => {
      if (i === 0 || line.trim() === "") return line;
      const leadingMatch = /^ */.exec(line)!;
      const leading = leadingMatch[0].length;
      const newLeading = Math.max(leading + delta, 0);
      return " ".repeat(newLeading) + line.slice(leading);
    })
    .join("\n");
}

/** Render `name:\n<reindented content>\n`, with the key at `nameKeyIndent` and content at `contentIndent`. */
function buildComponentEntryText(name: string, sliceText: string, oldBaseIndent: number, nameKeyIndent: number, contentIndent: number): string {
  const reindented = reindentBlock(sliceText, oldBaseIndent, contentIndent);
  const lines = reindented.split("\n");
  lines[0] = " ".repeat(contentIndent) + lines[0];
  return `${" ".repeat(nameKeyIndent)}${name}:\n${lines.join("\n")}\n`;
}

function collectSchemaNames(entryDoc: OasisDocument): Set<string> {
  const names = new Set<string>();
  const root = entryDoc.yamlDoc.contents;
  if (!isNode(root) || !isMap(root)) return names;
  const componentsNode = childAt(root, "components");
  if (!componentsNode || !isMap(componentsNode)) return names;
  const schemasNode = childAt(componentsNode, "schemas");
  if (!schemasNode || !isMap(schemasNode)) return names;
  for (const pair of schemasNode.items) {
    if (isScalar(pair.key)) names.add(String(pair.key.value));
  }
  return names;
}

/** Build the entry-document edit that inserts `name: <schema>` under `components/schemas`, creating
 * `components:`/`schemas:` scaffolding as needed. */
function buildInsertComponentSchemaEdit(entryDoc: OasisDocument, name: string, sourceDoc: OasisDocument, schemaNode: Node): CodeActionFileEdit | undefined {
  if (!schemaNode.range) return undefined;
  const sliceEnd = trimTrailingWhitespaceEnd(sourceDoc.text, schemaNode.range[0], schemaNode.range[1]);
  const sliceText = sourceDoc.text.slice(schemaNode.range[0], sliceEnd);
  const oldBaseIndent = columnAt(sourceDoc, schemaNode.range[0]);

  const root = entryDoc.yamlDoc.contents;
  if (!isNode(root) || !isMap(root)) return undefined;
  const componentsNode = childAt(root, "components");

  if (componentsNode) {
    if (!isMap(componentsNode)) return undefined;
    const schemasNode = childAt(componentsNode, "schemas");

    if (schemasNode) {
      if (!isMap(schemasNode) || schemasNode.items.length === 0) return undefined; // unsupported edge case
      const firstItem = schemasNode.items[0]!;
      if (!isNode(firstItem.key) || !firstItem.key.range) return undefined;
      const keyIndent = columnAt(entryDoc, firstItem.key.range[0]);
      const insertOffset = lineStartOffset(entryDoc, firstItem.key.range[0]);
      const text = buildComponentEntryText(name, sliceText, oldBaseIndent, keyIndent, keyIndent + 2);
      return { filePath: entryDoc.filePath, range: zeroWidthRange(entryDoc, insertOffset), newText: text };
    }

    if (componentsNode.items.length === 0) return undefined; // unsupported edge case (e.g. `components: {}`)
    const firstItem = componentsNode.items[0]!;
    if (!isNode(firstItem.key) || !firstItem.key.range) return undefined;
    const schemasKeyIndent = columnAt(entryDoc, firstItem.key.range[0]);
    const insertOffset = lineStartOffset(entryDoc, firstItem.key.range[0]);
    const nameKeyIndent = schemasKeyIndent + 2;
    const entryText = buildComponentEntryText(name, sliceText, oldBaseIndent, nameKeyIndent, nameKeyIndent + 2);
    const text = `${" ".repeat(schemasKeyIndent)}schemas:\n${entryText}`;
    return { filePath: entryDoc.filePath, range: zeroWidthRange(entryDoc, insertOffset), newText: text };
  }

  // No `components` section at all: append one at the end of the document.
  const entryText = buildComponentEntryText(name, sliceText, oldBaseIndent, 4, 6);
  const componentsBlock = `components:\n  schemas:\n${entryText}`;
  const needsLeadingNewline = !entryDoc.text.endsWith("\n");
  const insertOffset = entryDoc.text.length;
  return {
    filePath: entryDoc.filePath,
    range: zeroWidthRange(entryDoc, insertOffset),
    newText: (needsLeadingNewline ? "\n" : "") + componentsBlock,
  };
}

function buildExtractToComponent(graph: WorkspaceGraph, entryDoc: OasisDocument, doc: OasisDocument, position: Position): CodeActionResult | undefined {
  const offset = offsetAtPosition(doc.lineCounter, position);
  const found = nodeAtPosition(doc, offset);
  if (!found) return undefined;

  const segments = parsePointer(found.pointer);
  let schemaSegs: string[] | undefined;
  for (let i = segments.length; i >= 1; i--) {
    if (segments[i - 1] === "schema") {
      schemaSegs = segments.slice(0, i);
      break;
    }
  }
  if (!schemaSegs || schemaSegs[0] === "components") return undefined;

  const schemaResult = nodeAtPointer(doc, formatPointer(schemaSegs));
  if (!schemaResult || !isMap(schemaResult.node) || !schemaResult.node.range) return undefined;
  if (isRefObject(schemaResult.node)) return undefined;

  // Find the enclosing operation (for naming) by looking for an HTTP-method segment on the way up.
  let operationId: string | undefined;
  let method: string | undefined;
  for (let i = 1; i < schemaSegs.length; i++) {
    const seg = schemaSegs[i - 1]!;
    if ((HTTP_METHODS as readonly string[]).includes(seg)) {
      method = seg;
      const opResult = nodeAtPointer(doc, formatPointer(schemaSegs.slice(0, i)));
      if (opResult && isMap(opResult.node)) {
        const idNode = childAt(opResult.node, "operationId");
        if (isScalar(idNode) && typeof idNode.value === "string" && idNode.value !== "") operationId = idNode.value;
      }
      break;
    }
  }

  const baseId = operationId ?? `${method ?? "operation"}Operation`;
  const kindSuffix = schemaSegs.includes("responses")
    ? "Response"
    : schemaSegs.includes("requestBody")
      ? "RequestBody"
      : schemaSegs.includes("parameters")
        ? "Param"
        : "Schema";
  const candidateName = `${toPascal(baseId)}${kindSuffix}`;

  const name = dedupeName(candidateName, collectSchemaNames(entryDoc));
  const entryEdit = buildInsertComponentSchemaEdit(entryDoc, name, doc, schemaResult.node);
  if (!entryEdit) return undefined;

  const refValue = doc.filePath === entryDoc.filePath ? `#/components/schemas/${name}` : `${relativeRefPath(doc.filePath, entryDoc.filePath)}#/components/schemas/${name}`;

  const replaceEnd = trimTrailingWhitespaceEnd(doc.text, schemaResult.node.range[0], schemaResult.node.range[1]);
  const replaceRange = rangeFromOffsets(doc.filePath, doc.lineCounter, schemaResult.node.range[0], replaceEnd);
  const replaceEdit: CodeActionFileEdit = { filePath: doc.filePath, range: replaceRange, newText: `$ref: '${refValue}'` };

  return { title: "Extract inline schema to components", kind: "refactor.extract", edits: [replaceEdit, entryEdit] };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Compute code actions for `params`: quickfixes for the oasis lint diagnostics reported in
 * `params.diagnostics` (operation-operationId, operation-description, path-params-defined,
 * no-unused-components), plus a refactor.extract action when the cursor sits inside an
 * extractable inline schema. Returns [] rather than a broken edit whenever the AST no longer
 * matches what a diagnostic describes (a stale diagnostic from an outdated publish).
 *
 * YAML documents only: JSON/JSONC documents (detected by file extension) get no code actions,
 * since robust JSON-aware insertion (comma/formatting bookkeeping) is out of scope for now.
 */
export async function getCodeActions(ctx: ServerContext, params: CodeActionsParams): Promise<CodeActionResult[]> {
  const entryPath = await resolveEntryForPath(ctx, params.path);
  const graph = await getGraph(ctx, entryPath);
  const doc = getDocument(graph, params.path);
  const entryDoc = getDocument(graph, entryPath);
  if (!doc || !entryDoc || !isYamlDocument(doc) || !isYamlDocument(entryDoc)) return [];

  const results: CodeActionResult[] = [];

  params.diagnostics.forEach((diag, index) => {
    let action: CodeActionResult | undefined;
    switch (diag.code) {
      case "operation-operationId":
        action = buildAddOperationId(graph, entryDoc, doc, diag, index);
        break;
      case "operation-description":
        action = buildAddDescription(graph, entryDoc, doc, diag, index);
        break;
      case "path-params-defined":
        action = buildAddPathParam(graph, entryDoc, doc, diag, index);
        break;
      case "no-unused-components":
        action = buildRemoveUnusedComponent(doc, diag, index);
        break;
      default:
        break;
    }
    if (action) results.push(action);
  });

  const extract = buildExtractToComponent(graph, entryDoc, doc, params.position);
  if (extract) results.push(extract);

  return results;
}
