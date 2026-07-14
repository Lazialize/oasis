import { isMap, isScalar, isNode } from "yaml";
import type { Node } from "yaml";
import { detectVersion } from "@oasis/core";
import type { OasisDocument, Range } from "@oasis/core";
import { HTTP_METHODS } from "@oasis/linter";
import { getChildNode, nodeRange } from "../yaml-helpers.ts";

export type SymbolNodeKind = "namespace" | "operation" | "object" | "info";

export interface SymbolResult {
  name: string;
  kind: SymbolNodeKind;
  range: Range;
  children: SymbolResult[];
}

/**
 * Symbols for one Path Item container map (`paths` or 3.1 `webhooks`): one child per entry (a path
 * template or webhook name), each with an operation child per HTTP method. Mirrors the traversal
 * `iteratePathItems`/workspace symbols use — a top-level `$ref` Path Item simply has no method keys
 * of its own, so it appears as a childless entry.
 */
function pathItemContainerSymbols(containerNode: Node, doc: OasisDocument): SymbolResult[] {
  const children: SymbolResult[] = [];
  if (!isMap(containerNode)) return children;
  for (const pair of containerNode.items) {
    if (!isNode(pair.value) || !isScalar(pair.key)) continue;
    const entryName = String(pair.key.value);
    const opChildren: SymbolResult[] = [];
    if (isMap(pair.value)) {
      for (const opPair of pair.value.items) {
        if (!isScalar(opPair.key) || !isNode(opPair.value)) continue;
        const method = String(opPair.key.value);
        if (!(HTTP_METHODS as readonly string[]).includes(method)) continue;
        opChildren.push(makeSymbol(method.toUpperCase(), "operation", opPair.value, doc, []));
      }
    }
    children.push(makeSymbol(entryName, "namespace", pair.value, doc, opChildren));
  }
  return children;
}

/** Outline: paths and (3.1) webhooks (one symbol per entry, children per operation), components
 * (per section, per name), info. */
export function getDocumentSymbols(doc: OasisDocument): SymbolResult[] {
  const root = doc.yamlDoc.contents;
  if (!isMap(root)) return [];

  const symbols: SymbolResult[] = [];

  const infoNode = getChildNode(root, "info");
  if (infoNode) symbols.push(makeSymbol("info", "info", infoNode, doc, []));

  const pathsNode = getChildNode(root, "paths");
  if (pathsNode && isMap(pathsNode)) {
    symbols.push(makeSymbol("paths", "namespace", pathsNode, doc, pathItemContainerSymbols(pathsNode, doc)));
  }

  // `webhooks` is a 3.1-only root map of Path Items; on 3.0 documents it isn't a spec key, so a
  // stray `webhooks` mapping is left out of the outline (matching workspace symbols / the linter).
  if (detectVersion(doc) === "3.1") {
    const webhooksNode = getChildNode(root, "webhooks");
    if (webhooksNode && isMap(webhooksNode)) {
      symbols.push(makeSymbol("webhooks", "namespace", webhooksNode, doc, pathItemContainerSymbols(webhooksNode, doc)));
    }
  }

  const componentsNode = getChildNode(root, "components");
  if (componentsNode && isMap(componentsNode)) {
    const sectionSymbols: SymbolResult[] = [];
    for (const sectionPair of componentsNode.items) {
      if (!isScalar(sectionPair.key) || !isNode(sectionPair.value)) continue;
      const sectionName = String(sectionPair.key.value);
      const nameSymbols: SymbolResult[] = [];
      if (isMap(sectionPair.value)) {
        for (const namePair of sectionPair.value.items) {
          if (!isScalar(namePair.key) || !isNode(namePair.value)) continue;
          nameSymbols.push(makeSymbol(String(namePair.key.value), "object", namePair.value, doc, []));
        }
      }
      sectionSymbols.push(makeSymbol(sectionName, "namespace", sectionPair.value, doc, nameSymbols));
    }
    symbols.push(makeSymbol("components", "namespace", componentsNode, doc, sectionSymbols));
  }

  return symbols;
}

function makeSymbol(name: string, kind: SymbolNodeKind, node: Node, doc: OasisDocument, children: SymbolResult[]): SymbolResult {
  return { name, kind, range: nodeRange(doc, node), children };
}
