import { isAlias, isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import {
  classifyUriReference,
  detectVersion,
  findRefs,
  findSubtreeRefs,
  formatPointer,
  nodeAtPointer,
  nodeAtPosition,
  offsetAtPosition,
  parsePointer,
  parseRefString,
  positionAtOffset,
  rangeFromOffsets,
  resolveFileReference,
  resolveRef,
} from "@oasis/core";
import type { OasisDocument, Position, Range, WorkspaceGraph } from "@oasis/core";
import {
  COMPONENT_CATEGORIES,
  HTTP_METHODS,
  childAt,
  isRefObject,
  iterateOperations,
  iteratePathItems,
  keyToString,
  resolveMaybeRef,
} from "@oasis/linter";
import { relativeRefPath } from "../ref-target-path.ts";
import { findAllGraphsContaining, getDocument, resolveDocContext } from "../workspace.ts";
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
  kind: "quickfix" | "refactor.extract" | "refactor.inline";
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
// 3: Add parameter definition (paths/params-defined)
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
    // An explicitly empty `parameters: []`: replace the whole empty flow sequence with a block
    // sequence carrying the new item, indented relative to the `parameters` *key*. The previous
    // code inserted a block item at the node's start offset (the `[`), leaving the `[]` dangling
    // after it and producing malformed YAML.
    if (!parametersNode.range) return undefined;
    const keyNode = keyNodeForValue(targetNode, parametersNode);
    if (!keyNode || !keyNode.range) return undefined;
    const keyColumn = columnAt(targetDoc, keyNode.range[0]);
    const block = buildParamItemLines(keyColumn + 4, paramName);
    // Back the replacement start up over the spaces between `parameters:` and `[` so the block
    // sequence starts cleanly on its own line (no dangling trailing space after the colon).
    let replaceStart = parametersNode.range[0];
    while (replaceStart > 0 && (targetDoc.text[replaceStart - 1] === " " || targetDoc.text[replaceStart - 1] === "\t")) replaceStart--;
    const replaceRange = rangeFromOffsets(targetDoc.filePath, targetDoc.lineCounter, replaceStart, parametersNode.range[1]);
    return {
      title: "Add parameter definition",
      kind: "quickfix",
      edits: [{ filePath: targetDoc.filePath, range: replaceRange, newText: `\n${block}` }],
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

/**
 * Find `child`'s own key `Node` within map `node`, by value identity (works since `childAt`/
 * lookups hand back a map's own `pair.value` node references, never copies).
 */
function keyNodeForValue(node: Node, child: Node): Node | undefined {
  if (!isMap(node)) return undefined;
  const pair = node.items.find((p) => p.value === child);
  return pair && isNode(pair.key) ? pair.key : undefined;
}

/**
 * Whether any `$ref` in any of `graphs` resolves to `targetFilePath` + `pointer`. Guards the
 * destructive "Remove unused component" quickfix: a component can look unused in the graph that
 * produced the diagnostic yet still be referenced from a sibling project entry's graph, and
 * deleting it would break that entry. Only graphs that actually load the target file can resolve a
 * ref to it, so others are skipped.
 */
function isReferencedInAnyGraph(graphs: WorkspaceGraph[], targetFilePath: string, pointer: string): boolean {
  for (const graph of graphs) {
    if (!graph.documents.has(targetFilePath)) continue;
    for (const fileDoc of graph.documents.values()) {
      for (const ref of findRefs(fileDoc)) {
        const resolved = resolveRef(graph, fileDoc, ref.value);
        if (resolved.ok && resolved.doc.filePath === targetFilePath && resolved.pointer === pointer) return true;
      }
    }
  }
  return false;
}

function buildRemoveUnusedComponent(
  doc: OasisDocument,
  diag: CodeActionDiagnosticInput,
  index: number,
  allGraphs: WorkspaceGraph[],
): CodeActionResult | undefined {
  const { start, end } = toRangeOffsets(doc, diag.range);
  const root = doc.yamlDoc.contents;
  if (!isNode(root) || !isMap(root)) return undefined;
  const componentsNode = childAt(root, "components");
  if (!componentsNode || !isMap(componentsNode)) return undefined;
  const componentsKeyNode = keyNodeForValue(root, componentsNode);
  if (!componentsKeyNode || !componentsKeyNode.range) return undefined;

  for (const category of COMPONENT_CATEGORIES) {
    const categoryNode = childAt(componentsNode, category);
    if (!categoryNode || !isMap(categoryNode)) continue;
    const categoryKeyNode = keyNodeForValue(componentsNode, categoryNode);
    if (!categoryKeyNode || !categoryKeyNode.range) continue;

    for (const pair of categoryNode.items) {
      const value = pair.value;
      if (!isNode(value) || !value.range) continue;
      if (!matchesNodeRange(value, start, end)) continue;

      const keyNode = pair.key;
      if (!isNode(keyNode) || !keyNode.range) return undefined;
      const name = keyToString(keyNode);

      // Don't offer to delete a component that a sibling entry's graph still references (the
      // diagnostic may have been computed against a single graph, or be stale). Deleting it would
      // leave that sibling with a dangling `$ref`.
      if (isReferencedInAnyGraph(allGraphs, doc.filePath, `/components/${category}/${name}`)) return undefined;

      // Climb ancestors while the entry being removed is the sole item of its parent map: leaving
      // an empty `components/<category>: {}` (or `components: {}`) behind would be pointless, so
      // remove the parent's own key too — the inverse of how extract-to-component creates that key
      // when it's missing. Stops climbing at the first ancestor with more than one item, since
      // removing the target alone is then enough.
      let deleteKeyNode = keyNode;
      let deleteEndNode: Node = value;
      for (const ancestor of [
        { node: categoryNode as Node, keyNode: categoryKeyNode },
        { node: componentsNode as Node, keyNode: componentsKeyNode },
      ]) {
        if (!isMap(ancestor.node) || ancestor.node.items.length !== 1) break;
        deleteKeyNode = ancestor.keyNode;
        deleteEndNode = ancestor.node;
      }

      const deleteStart = lineStartOffset(doc, deleteKeyNode.range![0]);
      const deleteEnd = lineEndOffsetInclusive(doc, deleteEndNode.range?.[1] ?? value.range[1]);

      return {
        title: `Remove unused component '${name}'`,
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
 * `components:`/`schemas:` scaffolding as needed. When the schema moves across documents, internal
 * references are rewritten to keep resolving to the same canonical targets from the entry document
 * (or the whole action is suppressed — undefined — when that can't be done safely). */
function buildInsertComponentSchemaEdit(
  graph: WorkspaceGraph,
  entryDoc: OasisDocument,
  name: string,
  sourceDoc: OasisDocument,
  schemaNode: Node,
): CodeActionFileEdit | undefined {
  if (!schemaNode.range) return undefined;

  let rewrites: RefRewrite[] = [];
  if (sourceDoc.filePath !== entryDoc.filePath) {
    const planned = planSubtreeRefRewrites(graph, sourceDoc, schemaNode, entryDoc.filePath);
    if (!planned) return undefined;
    rewrites = planned;
  }

  const sliceEnd = trimTrailingWhitespaceEnd(sourceDoc.text, schemaNode.range[0], schemaNode.range[1]);
  const sliceText = applyRewritesToSlice(sourceDoc.text, schemaNode.range[0], sliceEnd, rewrites);
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
  const entryEdit = buildInsertComponentSchemaEdit(graph, entryDoc, name, doc, schemaResult.node);
  if (!entryEdit) return undefined;

  const refValue = doc.filePath === entryDoc.filePath ? `#/components/schemas/${name}` : `${relativeRefPath(doc.filePath, entryDoc.filePath)}#/components/schemas/${name}`;

  const replaceEnd = trimTrailingWhitespaceEnd(doc.text, schemaResult.node.range[0], schemaResult.node.range[1]);
  const replaceRange = rangeFromOffsets(doc.filePath, doc.lineCounter, schemaResult.node.range[0], replaceEnd);
  const replaceEdit: CodeActionFileEdit = { filePath: doc.filePath, range: replaceRange, newText: `$ref: '${refValue}'` };

  return { title: "Extract inline schema to components", kind: "refactor.extract", edits: [replaceEdit, entryEdit] };
}

// ---------------------------------------------------------------------------
// 6: Inline a $ref (refactor.inline, no diagnostic)
// ---------------------------------------------------------------------------

/** The `$ref` mapping (its node + JSON Pointer) at `offset`, if the cursor sits on one. Matches
 * both a click on the `$ref` key/value pair itself and anywhere else inside the (one-key) map. */
function findRefObjectAtPosition(doc: OasisDocument, offset: number): { node: Node; pointer: string } | undefined {
  const found = nodeAtPosition(doc, offset);
  if (!found) return undefined;
  if (isRefObject(found.node)) return { node: found.node, pointer: found.pointer };

  const segments = parsePointer(found.pointer);
  if (segments[segments.length - 1] !== "$ref") return undefined;
  const parentPointer = formatPointer(segments.slice(0, -1));
  const parent = nodeAtPointer(doc, parentPointer);
  if (!parent || !isRefObject(parent.node)) return undefined;
  return { node: parent.node, pointer: parentPointer };
}

/** A planned in-place replacement within a source document's text (absolute offsets). */
interface RefRewrite {
  start: number;
  end: number;
  newText: string;
}

/**
 * Plan the reference rewrites needed so that a subtree serialized out of `sourceDoc` still resolves
 * every internal reference to the same canonical target once it lives in `destPath`:
 * - same-document JSON Pointer refs (`#/...`) become `<rel-path-to-sourceDoc>#/...`,
 * - file-relative refs (`./x.yaml#/...`) are re-relativized from `destPath`'s directory,
 * - absolute non-filesystem URIs (`https:`, `urn:`) are location-independent and left unchanged.
 *
 * Which scalars count as references is decided by core's `findSubtreeRefs`, i.e. the same semantic
 * discovery that lint/graph loading use: real `{$ref}` objects *and* `discriminator.mapping` URI
 * values are rewritten, while `$ref`-shaped scalars buried in literal instance data
 * (`example`/`default`/`enum`/`const`) are left untouched — so relocation neither invents rewrites
 * for literal payloads nor misses a discriminator mapping URI.
 *
 * Returns undefined when relocation cannot be made safe by textual rewriting: YAML anchors/aliases
 * (document-scoped), `$id`/`$anchor`/`$dynamicAnchor` (which open nested resolution scopes),
 * plain-name anchor fragments (`#foo`), or `file:` URIs (whose FileSystem mapping is ambiguous) —
 * callers suppress the action in that case rather than emit a semantics-changing edit.
 */
function planSubtreeRefRewrites(graph: WorkspaceGraph, sourceDoc: OasisDocument, node: Node, destPath: string): RefRewrite[] | undefined {
  // Structural safety: anchors/aliases are document-scoped and `$id`/`$anchor`/`$dynamicAnchor` open
  // nested resolution scopes, so a textual copy of any of them changes meaning — suppress instead.
  if (!isSubtreeRelocatable(node)) return undefined;

  const rewrites: RefRewrite[] = [];
  for (const ref of findSubtreeRefs(sourceDoc, node)) {
    if (typeof ref.value !== "string" || !ref.range) return undefined;
    if (!planRef(ref.value, ref.range)) return undefined;
  }
  return rewrites;

  function planRef(value: string, range: readonly [number, number, number]): boolean {
    const kind = classifyUriReference(value);
    if (kind === "absolute") {
      // `https:`/`urn:` refs resolve identically from anywhere; `file:` URIs are routed through
      // the FileSystem abstraction in ways relocation can't reason about, so they suppress.
      return !/^file:/i.test(value);
    }
    const { filePart, pointer } = parseRefString(value);
    if (pointer !== "" && !pointer.startsWith("/")) return false; // plain-name anchor: scope-dependent
    const targetPath =
      filePart === "" ? sourceDoc.filePath : resolveFileReference(graph.fileSystem, sourceDoc.filePath, filePart);
    const fragment = pointer === "" && filePart !== "" ? "" : `#${pointer}`;
    const newRef = targetPath === destPath ? `#${pointer}` : `${relativeRefPath(destPath, targetPath)}${fragment}`;
    if (newRef === value) return true;
    if (targetPath === destPath && pointer === "") return false; // a whole-file self-ref makes no sense
    rewrites.push({ start: range[0], end: range[1], newText: `'${newRef}'` });
    return true;
  }
}

/**
 * Whether the subtree at `node` can be textually copied into another document without changing
 * meaning. Distinct from *reference discovery* (which core owns): this is relocation-specific
 * structural policy — YAML anchors/aliases are document-scoped, and `$id`/`$anchor`/`$dynamicAnchor`
 * open nested JSON Schema resolution scopes; any of them present makes a raw text copy unsafe.
 */
function isSubtreeRelocatable(node: Node): boolean {
  if (isAlias(node)) return false; // aliases/anchors are document-scoped; a textual copy breaks them
  if (node.anchor) return false;
  if (isMap(node)) {
    for (const pair of node.items) {
      const keyStr = isScalar(pair.key) ? String(pair.key.value) : undefined;
      if (keyStr === "$id" || keyStr === "$anchor" || keyStr === "$dynamicAnchor") return false;
      if (isNode(pair.value) && !isSubtreeRelocatable(pair.value)) return false;
    }
    return true;
  }
  if (isSeq(node)) {
    return node.items.every((item) => !isNode(item) || isSubtreeRelocatable(item));
  }
  return true;
}

/** Apply `rewrites` (absolute offsets into `text`) to the slice `[sliceStart, sliceEnd)`. */
function applyRewritesToSlice(text: string, sliceStart: number, sliceEnd: number, rewrites: RefRewrite[]): string {
  let out = text.slice(sliceStart, sliceEnd);
  const sorted = [...rewrites].sort((a, b) => b.start - a.start);
  for (const r of sorted) {
    if (r.start < sliceStart || r.end > sliceEnd) continue;
    out = out.slice(0, r.start - sliceStart) + r.newText + out.slice(r.end - sliceStart);
  }
  return out;
}

function buildInlineRef(graph: WorkspaceGraph, entryDoc: OasisDocument, doc: OasisDocument, position: Position): CodeActionResult | undefined {
  const offset = offsetAtPosition(doc.lineCounter, position);
  const found = findRefObjectAtPosition(doc, offset);
  if (!found) return undefined;
  const { node: refNode, pointer } = found;
  if (!isMap(refNode) || !refNode.range) return undefined;

  // 3.1 (JSON Schema) gives siblings of `$ref` meaning; 3.0 ignores them. Only offer the action
  // when inlining can't silently drop sibling keys.
  const version = detectVersion(entryDoc);
  if (version === "3.1" && refNode.items.length > 1) return undefined;

  // A whole Path Item behind a $ref (a direct entry of `paths`/`webhooks`) is large/structural;
  // not supported for now.
  const segments = parsePointer(pointer);
  if (segments.length === 2 && (segments[0] === "paths" || segments[0] === "webhooks")) return undefined;

  const refPair = refNode.items.find((p) => keyToString(p.key) === "$ref");
  if (!refPair || !isScalar(refPair.value) || typeof refPair.value.value !== "string") return undefined;

  const result = resolveRef(graph, doc, refPair.value.value);
  if (!result.ok || !result.node.range) return undefined; // unresolved target: not offered

  // Cycle check: would inlining loop back into one of the ref's own ancestors? Same-document only
  // (a simple ancestor-pointer check, not a full cross-file cycle search).
  if (result.doc.filePath === doc.filePath) {
    const targetSegs = parsePointer(result.pointer);
    const targetIsAncestor = targetSegs.length <= segments.length && targetSegs.every((seg, i) => seg === segments[i]);
    if (targetIsAncestor) return undefined;
  }

  // Cross-file inlining copies the target's serialized subtree into this document, where its
  // internal references would resolve against the wrong base. Rewrite every reference so it keeps
  // resolving to the same canonical target from here, or suppress the action when that can't be
  // done safely (anchors/aliases, $id scopes, plain-name anchors — see planSubtreeRefRewrites).
  let rewrites: RefRewrite[] = [];
  if (result.doc.filePath !== doc.filePath) {
    const planned = planSubtreeRefRewrites(graph, result.doc, result.node, doc.filePath);
    if (!planned) return undefined;
    rewrites = planned;
  }

  const sliceEnd = trimTrailingWhitespaceEnd(result.doc.text, result.node.range[0], result.node.range[1]);
  const sliceText = applyRewritesToSlice(result.doc.text, result.node.range[0], sliceEnd, rewrites);
  const oldBaseIndent = columnAt(result.doc, result.node.range[0]);
  const newBaseIndent = columnAt(doc, refNode.range[0]);
  const newText = reindentBlock(sliceText, oldBaseIndent, newBaseIndent);

  const replaceEnd = trimTrailingWhitespaceEnd(doc.text, refNode.range[0], refNode.range[1]);
  const replaceRange = rangeFromOffsets(doc.filePath, doc.lineCounter, refNode.range[0], replaceEnd);

  return {
    title: "Inline reference",
    kind: "refactor.inline",
    edits: [{ filePath: doc.filePath, range: replaceRange, newText }],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Compute code actions for `params`: quickfixes for the oasis lint diagnostics reported in
 * `params.diagnostics` (operation/operation-id, operation/description, paths/params-defined,
 * components/no-unused), plus a refactor.extract action when the cursor sits inside an
 * extractable inline schema, plus a refactor.inline action when the cursor sits on a `$ref`.
 * Returns [] rather than a broken edit whenever the AST no longer matches what a diagnostic
 * describes (a stale diagnostic from an outdated publish).
 *
 * YAML documents only: JSON/JSONC documents (detected by file extension) get no code actions,
 * since robust JSON-aware insertion (comma/formatting bookkeeping) is out of scope for now.
 */
export async function getCodeActions(ctx: ServerContext, params: CodeActionsParams): Promise<CodeActionResult[]> {
  const docCtx = await resolveDocContext(ctx, params.path);
  if (!docCtx) return [];
  const { graph, doc, entryPath } = docCtx;
  const entryDoc = getDocument(graph, entryPath);
  if (!entryDoc || !isYamlDocument(doc) || !isYamlDocument(entryDoc)) return [];

  const results: CodeActionResult[] = [];

  // Every loaded graph that holds the edited file, so the remove-unused quickfix can check for
  // cross-entry references before offering a destructive delete. Computed once, lazily used.
  const graphsWithDoc = await findAllGraphsContaining(ctx, doc.filePath);

  params.diagnostics.forEach((diag, index) => {
    let action: CodeActionResult | undefined;
    switch (diag.code) {
      case "operation/operation-id":
        action = buildAddOperationId(graph, entryDoc, doc, diag, index);
        break;
      case "operation/description":
        action = buildAddDescription(graph, entryDoc, doc, diag, index);
        break;
      case "paths/params-defined":
        action = buildAddPathParam(graph, entryDoc, doc, diag, index);
        break;
      case "components/no-unused":
        action = buildRemoveUnusedComponent(doc, diag, index, graphsWithDoc);
        break;
      default:
        break;
    }
    if (action) results.push(action);
  });

  const extract = buildExtractToComponent(graph, entryDoc, doc, params.position);
  if (extract) results.push(extract);

  const inlineRef = buildInlineRef(graph, entryDoc, doc, params.position);
  if (inlineRef) results.push(inlineRef);

  return results;
}
