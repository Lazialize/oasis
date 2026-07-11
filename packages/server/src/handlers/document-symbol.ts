import { isMap, isScalar, isNode } from "yaml";
import type { Node } from "yaml";
import { rangeFromOffsets } from "@oasis/core";
import type { OasisDocument, Range } from "@oasis/core";
import { getChildNode } from "../yaml-helpers.ts";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

export type SymbolNodeKind = "namespace" | "operation" | "object" | "info";

export interface SymbolResult {
  name: string;
  kind: SymbolNodeKind;
  range: Range;
  children: SymbolResult[];
}

/** Outline: paths (one symbol per path, children per operation), components (per section, per name), info. */
export function getDocumentSymbols(doc: OasisDocument): SymbolResult[] {
  const root = doc.yamlDoc.contents;
  if (!isMap(root)) return [];

  const symbols: SymbolResult[] = [];

  const infoNode = getChildNode(root, "info");
  if (infoNode) symbols.push(makeSymbol("info", "info", infoNode, doc, []));

  const pathsNode = getChildNode(root, "paths");
  if (pathsNode && isMap(pathsNode)) {
    const children: SymbolResult[] = [];
    for (const pair of pathsNode.items) {
      if (!isNode(pair.value) || !isScalar(pair.key)) continue;
      const pathName = String(pair.key.value);
      const opChildren: SymbolResult[] = [];
      if (isMap(pair.value)) {
        for (const opPair of pair.value.items) {
          if (!isScalar(opPair.key) || !isNode(opPair.value)) continue;
          const method = String(opPair.key.value);
          if (!HTTP_METHODS.includes(method)) continue;
          opChildren.push(makeSymbol(method.toUpperCase(), "operation", opPair.value, doc, []));
        }
      }
      children.push(makeSymbol(pathName, "namespace", pair.value, doc, opChildren));
    }
    symbols.push(makeSymbol("paths", "namespace", pathsNode, doc, children));
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
  const range = node.range
    ? rangeFromOffsets(doc.filePath, doc.lineCounter, node.range[0], node.range[2] ?? node.range[1])
    : rangeFromOffsets(doc.filePath, doc.lineCounter, 0, 0);
  return { name, kind, range, children };
}
