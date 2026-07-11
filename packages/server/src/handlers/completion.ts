import { isMap, isScalar } from "yaml";
import { detectVersion, formatPointer, nodeAtPointer, nodeAtPosition, offsetAtPosition, parsePointer } from "@oasis/core";
import type { OasisDocument, OpenApiVersion, Position, WorkspaceGraph } from "@oasis/core";
import { allowedKeys, classifyPointer, KIND_TO_COMPONENT_SECTION } from "../keywords.ts";
import { parentPointer } from "../refs.ts";
import { relativeRefPath } from "../ref-target-path.ts";
import { mapKeys } from "../yaml-helpers.ts";
import { getDocument, getGraph } from "../workspace.ts";
import type { ServerContext } from "../workspace.ts";

export type CompletionItemKind = "key" | "ref";

export interface CompletionItem {
  label: string;
  kind: CompletionItemKind;
}

export interface CompletionParams {
  path: string;
  position: Position;
}

/** Keys valid on the object living at `pointer`, for `version`, minus keys already present. */
export function keyCompletionsForPointer(pointer: string, version: OpenApiVersion, existingKeys: string[] = []): CompletionItem[] {
  const kind = classifyPointer(pointer);
  if (!kind) return [];
  const existing = new Set(existingKeys);
  return allowedKeys(kind, version)
    .filter((key) => !existing.has(key))
    .map((label) => ({ label, kind: "key" as const }));
}

/**
 * `$ref` target suggestions for a `$ref` living at `refPointer`: every component of the section
 * appropriate to the containing object, from every document in the workspace graph. Same-file
 * targets are formatted as `#/components/...`; cross-file targets as `./relative/path#/components/...`.
 */
export function refCompletionsForPointer(fromDoc: OasisDocument, graph: WorkspaceGraph, refPointer: string): CompletionItem[] {
  const containerPointer = refPointer.endsWith("/$ref") ? refPointer.slice(0, -"/$ref".length) : refPointer;
  const kind = classifyPointer(containerPointer);
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
      items.push({ label, kind: "ref" });
    }
  }
  return items;
}

/** Dispatches to `$ref` completion or key completion based on what's under the cursor. */
export async function getCompletions(ctx: ServerContext, params: CompletionParams): Promise<CompletionItem[]> {
  const graph = await getGraph(ctx, params.path);
  const doc = getDocument(graph, params.path);
  if (!doc) return [];

  const version = detectVersion(doc) ?? "3.1";
  const offset = offsetAtPosition(doc.lineCounter, params.position);
  const found = nodeAtPosition(doc, offset);
  if (!found) return [];

  if (isScalar(found.node) && (found.pointer.endsWith("/$ref") || found.pointer === "/$ref")) {
    return refCompletionsForPointer(doc, graph, found.pointer);
  }

  const containerPointer = isMap(found.node) ? found.pointer : parentPointer(found.pointer);
  const containerNode = nodeAtPointer(doc, containerPointer)?.node;
  const existingKeys = mapKeys(containerNode);
  return keyCompletionsForPointer(containerPointer, version, existingKeys);
}

// Re-exported so callers can build pointers without importing @oasis/core directly.
export { formatPointer, parsePointer };
