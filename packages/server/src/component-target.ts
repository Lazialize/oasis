import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import {
  formatPointer,
  looksLikeMappingRef,
  nodeAtPointer,
  nodeAtPosition,
  offsetAtPosition,
  parseFragmentPointer,
  parsePointer,
  rangeFromOffsets,
  resolveAlias,
  resolveRef,
} from "@oasis/core";
import type { OasisDocument, Position, Range, WorkspaceGraph } from "@oasis/core";
import { classifyPointer, inferRootKind } from "./keywords.ts";
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

/** If `fragment` (a resolved `$ref` pointer) is at or under `/components/<section>/<name>`, return
 * the enclosing component. */
function enclosingComponent(fragment: string): { section: string; name: string; pointer: string } | undefined {
  const segments = parseFragmentPointer(fragment);
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

/** A name-based (non-`$ref`) reference to a component: a Security Requirement Object key naming a
 * `components/securitySchemes` entry, or a bare discriminator `mapping` value naming a schema. */
export interface NameBasedRef {
  section: "securitySchemes" | "schemas";
  name: string;
  /** Range of the scalar carrying the name (the requirement key, or the mapping value). */
  range: Range;
}

/**
 * Find every name-based OpenAPI reference in `doc` that names a component by bare name rather than
 * a `$ref`: Security Requirement Object keys (root and operation scope) and discriminator `mapping`
 * values that are bare schema-component names. URI-style mapping values (`#/components/schemas/Dog`,
 * `./x.yaml#/Dog`) are left to `findRefs` — a bare name is the only form invisible to it (see
 * `looksLikeMappingRef`).
 *
 * Collection is gated on the *semantic* OpenAPI object kind of the enclosing map, classified from
 * the traversal pointer (#118): a `security` key is only a Security Requirement Object on the root
 * or an Operation Object, and a `discriminator` is only semantic on a Schema Object. Lookalike
 * `security`/`discriminator` structures sitting inside literal-data contexts — `example`, `examples`
 * values, `default`, `enum`, `const`, or an `x-*` vendor extension — classify to no known kind (the
 * pointer walk yields `undefined` once it descends into non-schema data), so they are skipped and a
 * rename can never rewrite a documented payload.
 */
export function collectNameBasedRefs(doc: OasisDocument): NameBasedRef[] {
  const results: NameBasedRef[] = [];
  const root = doc.yamlDoc.contents;
  const rootKind = inferRootKind(doc);
  if (isNode(root)) walk(root, [], new Set());
  return results;

  function scalarRange(node: unknown): Range | undefined {
    if (!isScalar(node) || !node.range) return undefined;
    return rangeFromOffsets(doc.filePath, doc.lineCounter, node.range[0], node.range[1]);
  }

  function walk(node: Node, path: string[], ancestors: Set<Node>): void {
    const resolved = resolveAlias(node, doc.yamlDoc);
    if (!resolved || ancestors.has(resolved)) return;
    ancestors.add(resolved);

    if (isMap(resolved)) {
      // The kind of *this* map: the object whose fields (`security`, `discriminator`) we inspect.
      const kind = classifyPointer(formatPointer(path), rootKind);
      const semanticSecurity = kind === "root" || kind === "operation";
      const semanticSchema = kind === "schema";

      for (const pair of resolved.items) {
        const keyStr = isScalar(pair.key) ? String(pair.key.value) : undefined;
        const value = isNode(pair.value) ? resolveAlias(pair.value, doc.yamlDoc) : undefined;

        // Security Requirement arrays: `security: [ { SchemeName: [scopes] }, ... ]`, but only where
        // `security` is a genuine field of the OpenAPI/Operation object, not literal example data.
        if (semanticSecurity && keyStr === "security" && isSeq(value)) {
          for (const item of value.items) {
            if (!isNode(item)) continue;
            const requirement = resolveAlias(item, doc.yamlDoc);
            if (!requirement || !isMap(requirement)) continue;
            for (const reqPair of requirement.items) {
              if (!isScalar(reqPair.key)) continue;
              const range = scalarRange(reqPair.key);
              if (range) results.push({ section: "securitySchemes", name: String(reqPair.key.value), range });
            }
          }
        }

        // Discriminator bare-name mappings: `discriminator: { mapping: { key: BareName } }`, but only
        // on an actual Schema Object — never a `discriminator`-shaped value inside literal data.
        if (semanticSchema && keyStr === "discriminator" && isMap(value)) {
          const mapping = value.items.find((p) => isScalar(p.key) && p.key.value === "mapping")?.value;
          const resolvedMapping = isNode(mapping) ? resolveAlias(mapping, doc.yamlDoc) : undefined;
          if (resolvedMapping && isMap(resolvedMapping)) {
            for (const mapPair of resolvedMapping.items) {
              if (!isNode(mapPair.value)) continue;
              const mapValue = resolveAlias(mapPair.value, doc.yamlDoc) ?? mapPair.value;
              if (!isScalar(mapValue) || typeof mapValue.value !== "string") continue;
              if (looksLikeMappingRef(mapValue.value)) continue; // a URI/pointer form, handled by findRefs
              const range = scalarRange(mapValue);
              if (range) results.push({ section: "schemas", name: mapValue.value, range });
            }
          }
        }

        if (isNode(pair.value) && keyStr !== undefined) walk(pair.value, [...path, keyStr], ancestors);
      }
    } else if (isSeq(resolved)) {
      resolved.items.forEach((item, index) => {
        if (isNode(item)) walk(item, [...path, String(index)], ancestors);
      });
    }

    ancestors.delete(resolved);
  }
}

/** The name-based reference whose own scalar range contains `position`, if any. */
export function nameBasedRefAtPosition(doc: OasisDocument, position: Position): NameBasedRef | undefined {
  const offset = offsetAtPosition(doc.lineCounter, position);
  return collectNameBasedRefs(doc).find((nb) => offset >= nb.range.startOffset && offset <= nb.range.endOffset);
}

/**
 * Resolve a name-based reference into the component it names, if that component exists: a Security
 * Requirement key names a `securitySchemes` entry of the graph's *entry* document's components; a
 * bare discriminator mapping name names a schema in the *same* document as the discriminator.
 */
function resolveNameBasedTarget(graph: WorkspaceGraph, doc: OasisDocument, nb: NameBasedRef): ComponentTarget | undefined {
  const targetDoc = nb.section === "securitySchemes" ? graph.documents.get(graph.entryPath) : doc;
  if (!targetDoc) return undefined;
  const pointer = formatPointer(["components", nb.section, nb.name]);
  if (!nodeAtPointer(targetDoc, pointer)) return undefined;
  return { doc: targetDoc, section: nb.section, name: nb.name, pointer };
}

/**
 * Resolve the "component" a cursor position refers to, from any side: on/inside a component's
 * definition (its key, or anywhere within its subtree), on a `$ref` value pointing at one (in
 * which case it resolves through the ref first, then behaves like the definition side), or on a
 * name-based reference (a Security Requirement key, or a bare discriminator mapping name). Returns
 * undefined when the cursor isn't on a renameable/referenceable component.
 */
export function resolveComponentTarget(graph: WorkspaceGraph, doc: OasisDocument, position: Position): ComponentTarget | undefined {
  const refAt = findRefAtPosition(doc, position);
  if (refAt) {
    const resolved = resolveRef(graph, doc, refAt.refString, refAt.range);
    if (!resolved.ok) return undefined;
    const comp = enclosingComponent(resolved.pointer);
    if (!comp) return undefined;
    return { doc: resolved.doc, ...comp };
  }

  const nameBased = nameBasedRefAtPosition(doc, position);
  if (nameBased) return resolveNameBasedTarget(graph, doc, nameBased);

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
 * The range of the component-*name* segment within a `$ref` value's raw source text (`refRange`,
 * which spans the whole scalar including any surrounding quotes). Unlike a plain tail-segment
 * search, this locates the name specifically as the segment following `components/<section>/`, so a
 * nested-pointer reference such as `#/components/schemas/Foo/properties/id` yields the range of
 * `Foo` (not `id`) and rename can replace only the name while preserving the `/properties/id`
 * suffix. Returns undefined if the marker isn't present or the name isn't a complete segment there.
 */
export function componentNameSegmentRange(
  doc: OasisDocument,
  refRange: Range,
  section: string,
  name: string,
): Range | undefined {
  const raw = doc.text.slice(refRange.startOffset, refRange.endOffset);
  const marker = `components/${section}/`;
  const markerIdx = raw.indexOf(marker);
  if (markerIdx === -1) return undefined;
  const nameStart = markerIdx + marker.length;
  if (raw.slice(nameStart, nameStart + name.length) !== name) return undefined;
  // The name must be a complete pointer segment: end-of-string, the next pointer separator, or a
  // closing quote — never a longer identifier that merely starts with `name`.
  const after = raw[nameStart + name.length];
  if (after !== undefined && after !== "/" && after !== '"' && after !== "'") return undefined;
  const startOffset = refRange.startOffset + nameStart;
  return rangeFromOffsets(doc.filePath, doc.lineCounter, startOffset, startOffset + name.length);
}
