import { isMap, isNode, isScalar } from "yaml";
import type { Node } from "yaml";
import { rangeFromOffsets } from "@oasis/core";
import type { OasisDocument, Range } from "@oasis/core";
import { getChildNode, getChildScalar } from "../yaml-helpers.ts";
import type { ServerContext } from "../workspace.ts";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
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
 * Every `components/<section>/<name>` definition and every operation (keyed by `operationId`)
 * across all currently-loaded workspace graphs (project entries plus open standalone documents —
 * anything with a cached graph in `ctx.graphCache`), filtered by a case-insensitive substring
 * match on `query` (empty query returns everything, capped at `MAX_RESULTS`).
 *
 * A document reachable from more than one graph (e.g. a shared fragment referenced by two
 * project entries) is only ever visited once.
 */
export function getWorkspaceSymbols(ctx: ServerContext, query: string): WorkspaceSymbolResult[] {
  const q = query.toLowerCase();
  const seenFiles = new Set<string>();
  const results: WorkspaceSymbolResult[] = [];

  for (const graph of ctx.graphCache.values()) {
    for (const doc of graph.documents.values()) {
      if (seenFiles.has(doc.filePath)) continue;
      seenFiles.add(doc.filePath);

      for (const symbol of documentSymbols(doc)) {
        if (q !== "" && !symbol.name.toLowerCase().includes(q)) continue;
        results.push(symbol);
        if (results.length >= MAX_RESULTS) return results;
      }
    }
  }
  return results;
}

function documentSymbols(doc: OasisDocument): WorkspaceSymbolResult[] {
  const root = doc.yamlDoc.contents;
  if (!isMap(root)) return [];

  const results: WorkspaceSymbolResult[] = [];

  const componentsNode = getChildNode(root, "components");
  if (componentsNode && isMap(componentsNode)) {
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
  }

  collectOperations(doc, getChildNode(root, "paths"), results);
  collectOperations(doc, getChildNode(root, "webhooks"), results);

  return results;
}

function collectOperations(doc: OasisDocument, sectionNode: Node | undefined, results: WorkspaceSymbolResult[]): void {
  if (!sectionNode || !isMap(sectionNode)) return;
  for (const pair of sectionNode.items) {
    if (!isScalar(pair.key) || !isNode(pair.value) || !isMap(pair.value)) continue;
    const containerName = String(pair.key.value);
    for (const opPair of pair.value.items) {
      if (!isScalar(opPair.key) || !isNode(opPair.value)) continue;
      const method = String(opPair.key.value);
      if (!HTTP_METHODS.includes(method)) continue;
      const operationId = getChildScalar(opPair.value, "operationId");
      if (!operationId) continue;
      results.push({
        name: operationId,
        kind: "method",
        containerName,
        filePath: doc.filePath,
        range: nodeRange(doc, opPair.value),
      });
    }
  }
}

function nodeRange(doc: OasisDocument, node: Node): Range {
  const range = node.range;
  return range ? rangeFromOffsets(doc.filePath, doc.lineCounter, range[0], range[2] ?? range[1]) : rangeFromOffsets(doc.filePath, doc.lineCounter, 0, 0);
}
