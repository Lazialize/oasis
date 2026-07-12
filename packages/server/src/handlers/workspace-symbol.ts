import { isMap, isNode, isScalar } from "yaml";
import { detectVersion } from "@oasis/core";
import type { OasisDocument, Range, WorkspaceGraph } from "@oasis/core";
import { iterateOperations } from "@oasis/linter";
import { getChildNode, getChildScalar, nodeRange } from "../yaml-helpers.ts";
import { getDocument, getGraph } from "../workspace.ts";
import type { ServerContext } from "../workspace.ts";

const MAX_RESULTS = 1000;

export type WorkspaceSymbolKind = "class" | "variable" | "interface" | "key" | "method" | "object";

export interface WorkspaceSymbolResult {
  name: string;
  kind: WorkspaceSymbolKind;
  /** e.g. "components/schemas", or a path template / webhook key for operations. */
  containerName: string;
  filePath: string;
  range: Range;
}

/** `components/<section>/<name>` -> LSP-ish symbol kind. Chosen for a rough visual match in
 * pickers rather than any deep semantic claim: schemas are the closest thing OpenAPI has to
 * types (Class), parameters/securitySchemes are named values (Variable/Key), responses are
 * contracts (Interface); everything else (requestBodies, headers, examples, links, callbacks,
 * and 3.1 pathItems) falls back to Object. */
const SECTION_KIND: Record<string, WorkspaceSymbolKind> = {
  schemas: "class",
  parameters: "variable",
  responses: "interface",
  securitySchemes: "key",
};

/**
 * Per-document memo of a document's own `components/<section>/<name>` symbols. Keyed by document
 * identity (a `WeakMap`, like `findRefsCache` in `packages/core/src/ref.ts`), so a re-parsed
 * document (e.g. after an LSP edit invalidates its graph) naturally gets a fresh entry, and every
 * `getWorkspaceSymbols` call after the first for an unchanged document skips the AST walk.
 */
const componentSymbolsCache = new WeakMap<OasisDocument, WorkspaceSymbolResult[]>();

function componentSymbolsFor(doc: OasisDocument): WorkspaceSymbolResult[] {
  const cached = componentSymbolsCache.get(doc);
  if (cached) return cached;
  const result = computeComponentSymbols(doc);
  componentSymbolsCache.set(doc, result);
  return result;
}

function computeComponentSymbols(doc: OasisDocument): WorkspaceSymbolResult[] {
  const root = doc.yamlDoc.contents;
  if (!isMap(root)) return [];

  const results: WorkspaceSymbolResult[] = [];
  const componentsNode = getChildNode(root, "components");
  if (!componentsNode || !isMap(componentsNode)) return results;

  for (const sectionPair of componentsNode.items) {
    if (!isScalar(sectionPair.key) || !isNode(sectionPair.value) || !isMap(sectionPair.value)) continue;
    const section = String(sectionPair.key.value);
    for (const namePair of sectionPair.value.items) {
      if (!isScalar(namePair.key) || !isNode(namePair.value)) continue;
      results.push({
        name: String(namePair.key.value),
        kind: SECTION_KIND[section] ?? "object",
        containerName: `components/${section}`,
        filePath: doc.filePath,
        range: nodeRange(doc, namePair.value),
      });
    }
  }
  return results;
}

/**
 * Per-graph memo of the operation symbols reachable from a graph's entry document (following
 * `$ref`s, version-aware — see `iterateOperations`). Keyed by the `WorkspaceGraph` object itself:
 * a graph is rebuilt (a new object) whenever a document it contains changes (`invalidateGraph`),
 * so this never serves stale operations, and repeated `getWorkspaceSymbols` calls between edits
 * skip re-walking `paths`/`webhooks` and re-resolving refs.
 */
const operationSymbolsCache = new WeakMap<WorkspaceGraph, WorkspaceSymbolResult[]>();

function operationSymbolsFor(graph: WorkspaceGraph, entryPath: string): WorkspaceSymbolResult[] {
  const cached = operationSymbolsCache.get(graph);
  if (cached) return cached;
  const entryDoc = getDocument(graph, entryPath);
  const result = entryDoc ? computeOperationSymbols(graph, entryDoc) : [];
  operationSymbolsCache.set(graph, result);
  return result;
}

function computeOperationSymbols(graph: WorkspaceGraph, entryDoc: OasisDocument): WorkspaceSymbolResult[] {
  const version = detectVersion(entryDoc);
  const results: WorkspaceSymbolResult[] = [];
  for (const op of iterateOperations(graph, entryDoc, version)) {
    const operationId = getChildScalar(op.node, "operationId");
    if (!operationId) continue;
    results.push({
      name: operationId,
      kind: "method",
      containerName: op.pathItem.template,
      filePath: op.doc.filePath,
      range: nodeRange(op.doc, op.node),
    });
  }
  return results;
}

/**
 * Every `components/<section>/<name>` definition and every operation (keyed by `operationId`)
 * across all currently-loaded workspace graphs (project entries plus open standalone documents —
 * anything with a cached graph in `ctx.graphCache`), filtered by a case-insensitive substring
 * match on `query` (empty query returns everything, capped at `MAX_RESULTS`).
 *
 * A document reachable from more than one graph (e.g. a shared fragment referenced by two
 * project entries) contributes its own (non-operation) symbols only once. Operations are resolved
 * per-graph via `iterateOperations`, which follows `$ref`'d path items/operations, so operations
 * defined in a fragment file are found too; a shared operation reachable from more than one graph
 * is deduplicated by (file, pointer).
 *
 * Before walking, any loaded project whose graph was evicted from `ctx.graphCache` (e.g. by
 * `invalidateGraph` on an unrelated document close — see `connection.ts`'s `onDidClose`) is
 * lazily rebuilt via `getGraph`, so a project doesn't silently drop out of workspace symbols until
 * some unrelated edit happens to touch it again.
 */
export async function getWorkspaceSymbols(ctx: ServerContext, query: string): Promise<WorkspaceSymbolResult[]> {
  for (const project of ctx.projects.values()) {
    for (const entryPath of project.entryPaths) {
      if (!ctx.graphCache.has(entryPath)) await getGraph(ctx, entryPath);
    }
  }

  const q = query.toLowerCase();
  const seenComponentFiles = new Set<string>();
  const seenOperations = new Set<string>();
  const results: WorkspaceSymbolResult[] = [];

  const pushIfMatches = (symbol: WorkspaceSymbolResult): boolean => {
    if (q !== "" && !symbol.name.toLowerCase().includes(q)) return true;
    results.push(symbol);
    return results.length < MAX_RESULTS;
  };

  for (const [entryPath, graph] of ctx.graphCache) {
    for (const doc of graph.documents.values()) {
      if (seenComponentFiles.has(doc.filePath)) continue;
      seenComponentFiles.add(doc.filePath);
      for (const symbol of componentSymbolsFor(doc)) {
        if (!pushIfMatches(symbol)) return results;
      }
    }

    for (const symbol of operationSymbolsFor(graph, entryPath)) {
      const key = `${symbol.filePath}::${symbol.containerName}::${symbol.name}`;
      if (seenOperations.has(key)) continue;
      seenOperations.add(key);
      if (!pushIfMatches(symbol)) return results;
    }
  }
  return results;
}
