import { isMap, isScalar } from "yaml";
import type { Node } from "yaml";
import {
  formatPointer,
  nodeAtPointer,
  nodeAtPosition,
  offsetAtPosition,
  parsePointer,
  rangeFromOffsets,
  resolveRef,
} from "@oasis/core";
import type { OasisDocument, Position, Range, WorkspaceGraph } from "@oasis/core";
import { findRefAtPosition } from "./refs.ts";

/** A resolved `components/<section>/<name>` definition, shared by find-references and rename. */
export interface ComponentTarget {
  /** The document that owns the component's definition (the file whose `components` section it lives in). */
  doc: OasisDocument;
  /** Component section, e.g. "schemas". */
  section: string;
  /** Component name, e.g. "Pet". */
  name: string;
  /** JSON Pointer of the definition itself, e.g. "/components/schemas/Pet". */
  pointer: string;
}

/** If `pointer` is at or under `/components/<section>/<name>`, return the enclosing component. */
function enclosingComponent(pointer: string): { section: string; name: string; pointer: string } | undefined {
  const segments = parsePointer(pointer);
  if (segments[0] !== "components" || segments.length < 3) return undefined;
  const section = segments[1]!;
  const name = segments[2]!;
  return { section, name, pointer: formatPointer(["components", section, name]) };
}

/** The pair whose key scalar's range contains `offset`, if any. */
function keyAtOffset(mapNode: Node, offset: number): { name: string } | undefined {
  if (!isMap(mapNode)) return undefined;
  for (const pair of mapNode.items) {
    if (isScalar(pair.key) && pair.key.range && offset >= pair.key.range[0] && offset <= pair.key.range[1]) {
      return { name: String(pair.key.value) };
    }
  }
  return undefined;
}

/**
 * Resolve the "component" a cursor position refers to, from either side: on/inside a component's
 * definition (its key, or anywhere within its subtree), or on a `$ref` value pointing at one (in
 * which case it resolves through the ref first, then behaves like the definition side). Returns
 * undefined when the cursor isn't on a renameable/referenceable component.
 */
export function resolveComponentTarget(graph: WorkspaceGraph, doc: OasisDocument, position: Position): ComponentTarget | undefined {
  const refAt = findRefAtPosition(doc, position);
  if (refAt) {
    const resolved = resolveRef(graph, doc, refAt.refString);
    if (!resolved.ok) return undefined;
    const comp = enclosingComponent(resolved.pointer);
    if (!comp) return undefined;
    return { doc: resolved.doc, ...comp };
  }

  const offset = offsetAtPosition(doc.lineCounter, position);
  const found = nodeAtPosition(doc, offset);
  if (!found) return undefined;

  const direct = enclosingComponent(found.pointer);
  if (direct) return { doc, ...direct };

  // Cursor lands on a component's key text itself (e.g. "Pet:"): `nodeAtPosition` only descends
  // into map *values*, so it stops one level short (at "/components/<section>"). Check the
  // section map's keys directly for one whose own range covers the offset.
  const segments = parsePointer(found.pointer);
  if (segments.length === 2 && segments[0] === "components") {
    const hit = keyAtOffset(found.node, offset);
    if (hit) {
      const section = segments[1]!;
      return { doc, section, name: hit.name, pointer: formatPointer(["components", section, hit.name]) };
    }
  }

  return undefined;
}

/** The source range of a component's *key* node (e.g. `Pet` under `components/schemas/`). */
export function componentKeyRange(doc: OasisDocument, target: Pick<ComponentTarget, "section" | "name">): Range | undefined {
  const sectionNode = nodeAtPointer(doc, formatPointer(["components", target.section]))?.node;
  if (!sectionNode || !isMap(sectionNode)) return undefined;
  const pair = sectionNode.items.find((p) => isScalar(p.key) && p.key.value === target.name);
  if (!pair || !isScalar(pair.key) || !pair.key.range) return undefined;
  return rangeFromOffsets(doc.filePath, doc.lineCounter, pair.key.range[0], pair.key.range[1]);
}

/**
 * The range of `segmentName` as it appears at the tail of a `$ref` value's raw source text
 * (`refRange`, which spans the whole scalar including any surrounding quotes). Since a pointer
 * segment is always the final path component of the ref string, the rightmost occurrence of the
 * segment's text is unambiguous.
 */
export function refSegmentRange(doc: OasisDocument, refRange: Range, segmentName: string): Range | undefined {
  const raw = doc.text.slice(refRange.startOffset, refRange.endOffset);
  const idx = raw.lastIndexOf(segmentName);
  if (idx === -1) return undefined;
  const startOffset = refRange.startOffset + idx;
  const endOffset = startOffset + segmentName.length;
  return rangeFromOffsets(doc.filePath, doc.lineCounter, startOffset, endOffset);
}
