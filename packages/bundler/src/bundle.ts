import { isAlias, isMap, isNode, isScalar, isSeq, stringify as yamlStringify } from "yaml";
import type { Node, Pair, Scalar } from "yaml";
import {
  COMPONENT_SECTIONS,
  type Diagnostic,
  formatPointer,
  keyToString,
  type OasisDocument,
  type Range,
  type ResolvedRef,
  type WorkspaceGraph,
  parsePointer,
  rangeFromOffsets,
  resolveRef,
  zeroRange,
} from "@oasis/core";
import { fileStem, sanitizeName, uniqueName } from "./name.ts";

export interface BundleOptions {
  /** Output serialization format. Defaults to "yaml". */
  format?: "yaml" | "json";
  /**
   * Fully inline every `$ref` (internal and external) instead of lifting external refs into
   * `components/*`. Reference cycles cannot be fully inlined: the point of re-entry keeps a
   * `$ref` to a minimal `components/*` entry, and a warning diagnostic is emitted. Defaults to
   * false.
   */
  dereference?: boolean;
}

export interface BundleResult {
  output: string;
  diagnostics: Diagnostic[];
}

const COMPONENT_SECTION_SET = new Set<string>(COMPONENT_SECTIONS);

function findRefPair(node: Node): Pair | undefined {
  if (!isMap(node)) return undefined;
  return node.items.find(
    (p): p is Pair => keyToString(p.key) === "$ref" && isScalar(p.value) && typeof p.value.value === "string",
  );
}

function rangeOfScalar(doc: OasisDocument, scalar: Scalar): Range {
  return scalar.range ? rangeFromOffsets(doc.filePath, doc.lineCounter, scalar.range[0], scalar.range[1]) : zeroRange(doc.filePath);
}

function rangeOfNode(doc: OasisDocument, node: Node): Range {
  return node.range ? rangeFromOffsets(doc.filePath, doc.lineCounter, node.range[0], node.range[1]) : zeroRange(doc.filePath);
}

interface BundleContext {
  graph: WorkspaceGraph;
  entryDoc: OasisDocument;
  diagnostics: Diagnostic[];
  /** (targetFilePath, targetPointer) -> assigned {section, name}, so a given target is lifted once. */
  identityMap: Map<string, { section: string; name: string }>;
  /** section -> set of names already assigned within that component section. */
  usedNames: Map<string, Set<string>>;
  /** The live `components` object being built; lifted components are inserted here as they're found. */
  componentsOutput: Record<string, unknown>;
  /** When true, fully inline every `$ref` instead of lifting external ones into `components/*`. */
  dereference: boolean;
  /** Identity keys ("filePath pointer") currently being expanded, for cycle detection in dereference mode. */
  expansionStack: Set<string>;
  /** Identity keys that turned out to participate in a cycle -> the component slot kept for them. */
  cycleAssignments: Map<string, { section: string; name: string }>;
  /** Identity keys of entry-document components that were reached via some `$ref` during dereferencing. */
  visitedEntryIdentities: Set<string>;
  /** Anchor-target nodes currently being expanded, to break cyclic YAML `*alias` references. */
  aliasStack: Set<Node>;
}

function identityKeyOf(result: ResolvedRef): string {
  return `${result.doc.filePath} ${result.pointer}`;
}

function ensureUsedNames(ctx: BundleContext, section: string): Set<string> {
  let set = ctx.usedNames.get(section);
  if (!set) {
    set = new Set();
    ctx.usedNames.set(section, set);
  }
  return set;
}

function ensureSectionObject(ctx: BundleContext, section: string): Record<string, unknown> {
  let obj = ctx.componentsOutput[section] as Record<string, unknown> | undefined;
  if (!obj) {
    obj = {};
    ctx.componentsOutput[section] = obj;
  }
  return obj;
}

/** Derive the components section a lifted value belongs in. */
function deriveSection(pointer: string, hint: string | undefined): string {
  const segs = parsePointer(pointer);
  if (segs[0] === "components" && segs.length >= 2 && COMPONENT_SECTION_SET.has(segs[1] ?? "")) {
    return segs[1] as string;
  }
  return hint ?? "schemas";
}

/** Derive a deterministic, unique candidate name for a lifted value. */
function deriveName(ctx: BundleContext, pointer: string, doc: OasisDocument, section: string): string {
  const segs = parsePointer(pointer);
  const raw = segs.length > 0 ? segs[segs.length - 1] ?? "" : fileStem(doc.filePath);
  const candidate = sanitizeName(raw === "" ? fileStem(doc.filePath) : raw);
  return uniqueName(candidate, ensureUsedNames(ctx, section));
}

/** Merge a map of already-defined component names (from the entry's own `components`) into `usedNames`. */
function reserveEntryComponentNames(ctx: BundleContext, componentsNode: Node): void {
  if (!isMap(componentsNode)) return;
  for (const sectionPair of componentsNode.items) {
    const sectionName = keyToString(sectionPair.key);
    if (!isNode(sectionPair.value) || !isMap(sectionPair.value)) continue;
    const set = ensureUsedNames(ctx, sectionName);
    for (const entryPair of sectionPair.value.items) {
      set.add(keyToString(entryPair.key));
    }
  }
}

function mapChildren(ctx: BundleContext, doc: OasisDocument, mapNode: Node, hint: string): Record<string, unknown> {
  if (!isMap(mapNode)) return convertValue(ctx, doc, mapNode, hint) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const pair of mapNode.items) {
    if (!isNode(pair.value)) continue;
    out[keyToString(pair.key)] = convertValue(ctx, doc, pair.value, hint);
  }
  return out;
}

/** Resolve `refPair`'s `$ref`, returning the resolution (or undefined + a recorded warning diagnostic). */
function resolveRefPair(ctx: BundleContext, doc: OasisDocument, refPair: Pair): ReturnType<typeof resolveRef> {
  const scalar = refPair.value as Scalar;
  const refValue = scalar.value as string;
  const range = rangeOfScalar(doc, scalar);
  const result = resolveRef(ctx.graph, doc, refValue, range);
  if (!result.ok) {
    ctx.diagnostics.push({ ...result.diagnostic, severity: "warning" });
  }
  return result;
}

/** Convert a `$ref`-bearing map: lift external targets into components/*, or pass through internal refs unchanged. */
function convertRef(ctx: BundleContext, doc: OasisDocument, mapNode: Node, refPair: Pair, hint: string | undefined): unknown {
  const scalar = refPair.value as Scalar;
  const refValue = scalar.value as string;
  const result = resolveRefPair(ctx, doc, refPair);

  if (!result.ok) {
    return withSiblings(ctx, doc, mapNode, refValue, hint);
  }

  if (ctx.dereference) {
    return convertRefDereference(ctx, doc, mapNode, scalar, result, hint);
  }

  const isEntryTarget = result.doc.filePath === ctx.entryDoc.filePath;
  if (isEntryTarget) {
    return withSiblings(ctx, doc, mapNode, `#${result.pointer}`, hint);
  }

  const identityKey = identityKeyOf(result);
  let assigned = ctx.identityMap.get(identityKey);
  if (!assigned) {
    const section = deriveSection(result.pointer, hint);
    const name = deriveName(ctx, result.pointer, result.doc, section);
    assigned = { section, name };
    // Register before recursing so ref cycles among lifted components terminate.
    ctx.identityMap.set(identityKey, assigned);
    const content = convertValue(ctx, result.doc, result.node, section);
    ensureSectionObject(ctx, section)[name] = content;
  }

  return withSiblings(ctx, doc, mapNode, `#/components/${assigned.section}/${assigned.name}`, hint);
}

/**
 * Pick (or reuse) a `components/*` slot for a ref target that participates in a cycle. Entry-
 * document targets keep their original component name (already reserved in `usedNames`, so no
 * renaming is needed); cross-file targets get a fresh deterministic name like any lifted target.
 */
function assignCycleSlot(ctx: BundleContext, result: ResolvedRef, hint: string | undefined): { section: string; name: string } {
  const identityKey = identityKeyOf(result);
  const existing = ctx.cycleAssignments.get(identityKey);
  if (existing) return existing;

  const section = deriveSection(result.pointer, hint);
  const segs = parsePointer(result.pointer);
  const rawTail = segs.length > 0 ? segs[segs.length - 1] : undefined;
  const name =
    result.doc.filePath === ctx.entryDoc.filePath && rawTail
      ? sanitizeName(rawTail)
      : deriveName(ctx, result.pointer, result.doc, section);

  const assigned = { section, name };
  ctx.cycleAssignments.set(identityKey, assigned);
  return assigned;
}

/** Merge sibling keys (alongside `$ref`) into an already-dereferenced value, converted with the same mode. */
function mergeSiblingsInto(ctx: BundleContext, doc: OasisDocument, mapNode: Node, content: unknown, hint: string | undefined): unknown {
  if (!isMap(mapNode)) return content;
  const siblingPairs = mapNode.items.filter((p) => keyToString(p.key) !== "$ref" && isNode(p.value));
  if (siblingPairs.length === 0) return content;

  const base: Record<string, unknown> =
    typeof content === "object" && content !== null && !Array.isArray(content) ? { ...(content as Record<string, unknown>) } : {};
  for (const pair of siblingPairs) {
    base[keyToString(pair.key)] = convertValue(ctx, doc, pair.value as Node, hint);
  }
  return base;
}

/**
 * Convert a `$ref`-bearing map in `--dereference` mode: inline a deep, recursively-dereferenced
 * copy of the target. A ref whose target is already on the expansion stack (a cycle) cannot be
 * inlined; it's left as a `$ref` to a minimal `components/*` entry kept for that target, with a
 * warning diagnostic.
 */
function convertRefDereference(ctx: BundleContext, doc: OasisDocument, mapNode: Node, scalar: Scalar, result: ResolvedRef, hint: string | undefined): unknown {
  const identityKey = identityKeyOf(result);
  if (result.doc.filePath === ctx.entryDoc.filePath) ctx.visitedEntryIdentities.add(identityKey);

  if (ctx.expansionStack.has(identityKey)) {
    const assigned = assignCycleSlot(ctx, result, hint);
    ctx.diagnostics.push({
      message: `Reference cycle detected: "${result.doc.filePath}#${result.pointer || "/"}" cannot be fully dereferenced; kept as "$ref: #/components/${assigned.section}/${assigned.name}" to break the cycle`,
      severity: "warning",
      code: "ref-cycle",
      source: "bundler",
      range: rangeOfScalar(doc, scalar),
    });
    return withSiblings(ctx, doc, mapNode, `#/components/${assigned.section}/${assigned.name}`, hint);
  }

  ctx.expansionStack.add(identityKey);
  const content = convertValue(ctx, result.doc, result.node, hint);
  ctx.expansionStack.delete(identityKey);

  const cycleAssigned = ctx.cycleAssignments.get(identityKey);
  if (cycleAssigned) {
    ensureSectionObject(ctx, cycleAssigned.section)[cycleAssigned.name] = content;
  }

  return mergeSiblingsInto(ctx, doc, mapNode, content, hint);
}

function withSiblings(ctx: BundleContext, doc: OasisDocument, mapNode: Node, newRef: string, hint: string | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { $ref: newRef };
  if (!isMap(mapNode)) return out;
  for (const pair of mapNode.items) {
    const key = keyToString(pair.key);
    if (key === "$ref" || !isNode(pair.value)) continue;
    out[key] = convertValue(ctx, doc, pair.value, hint);
  }
  return out;
}

/**
 * Convert a Path Item Object node, inlining any `$ref` (whole-file or fragment) instead of lifting
 * it into components — OpenAPI 3.0 has no `components/pathItems`, and inlining is simple and
 * consistent behavior for 3.1 too. Follows chained path-item refs with a depth guard for safety.
 */
function convertPathItem(ctx: BundleContext, doc: OasisDocument, node: Node, depth = 0): unknown {
  if (depth > 20) return convertValue(ctx, doc, node, undefined);

  const refPair = findRefPair(node);
  if (refPair) {
    const scalar = refPair.value as Scalar;
    const refValue = scalar.value as string;
    const result = resolveRefPair(ctx, doc, refPair);
    // 3.1 allows a Path Item `$ref` to carry siblings (`summary`/`description`); those override the
    // target's own per 3.1 Reference Object semantics, same as `withSiblings`/`mergeSiblingsInto`
    // do for non-path-item refs. Merge them in on both the resolved and unresolved branches instead
    // of dropping them.
    if (!result.ok) return withPathItemSiblings(ctx, doc, node, { $ref: refValue });
    const target = convertPathItem(ctx, result.doc, result.node, depth + 1);
    return withPathItemSiblings(ctx, doc, node, target);
  }

  return convertValue(ctx, doc, node, undefined);
}

/** Merge a Path Item `$ref`'s sibling keys (e.g. `summary`, `description`) onto the inlined target. */
function withPathItemSiblings(ctx: BundleContext, doc: OasisDocument, node: Node, target: unknown): unknown {
  if (!isMap(node)) return target;
  const siblingPairs = node.items.filter((p) => keyToString(p.key) !== "$ref" && isNode(p.value));
  if (siblingPairs.length === 0) return target;

  const base: Record<string, unknown> =
    typeof target === "object" && target !== null && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const pair of siblingPairs) {
    base[keyToString(pair.key)] = convertValue(ctx, doc, pair.value as Node, undefined);
  }
  return base;
}

function convertPathsMap(ctx: BundleContext, doc: OasisDocument, mapNode: Node): Record<string, unknown> {
  if (!isMap(mapNode)) return convertValue(ctx, doc, mapNode, undefined) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const pair of mapNode.items) {
    if (!isNode(pair.value)) continue;
    out[keyToString(pair.key)] = convertPathItem(ctx, doc, pair.value);
  }
  return out;
}

/**
 * Keys whose value is arbitrary literal instance data (JSON Schema `example`/`default`/`enum`/
 * `const`), where a `{"$ref": "..."}` appearing inside is plain data rather than a reference to
 * lift/rewrite. `examples` is ambiguous by name alone: as a *sequence* it's the 3.1 JSON Schema
 * `examples` keyword (literal instances, same as `example`), but as a *map* it's an OpenAPI Media
 * Type/Parameter/Header `examples` field (name -> Example Object) whose entries may legitimately
 * `$ref` into `components/examples` — so only the sequence form is treated as literal data.
 */
function isLiteralDataKey(key: string, value: Node): boolean {
  if (key === "examples") return isSeq(value);
  return key === "example" || key === "default" || key === "enum" || key === "const";
}

/**
 * Convert a YAML AST node into a plain JS value, lifting/rewriting `$ref`s as it goes. `literal`,
 * once set by descending under a key like `example`/`default`/`enum`/`const` (see
 * `isLiteralDataKey`), stays set for the rest of the subtree: a `$ref`-shaped map found there is
 * plain data, not a reference, and is copied through unchanged rather than lifted/rewritten.
 */
function convertValue(ctx: BundleContext, doc: OasisDocument, node: Node | undefined, hint: string | undefined, literal = false): unknown {
  if (!node) return undefined;

  if (isAlias(node)) {
    const target = node.resolve(doc.yamlDoc);
    if (!target) {
      ctx.diagnostics.push({
        message: `Unresolved YAML alias "*${node.source}": no matching anchor`,
        severity: "warning",
        code: "unresolved-alias",
        source: "bundler",
        range: rangeOfNode(doc, node),
      });
      return undefined;
    }
    if (ctx.aliasStack.has(target)) {
      ctx.diagnostics.push({
        message: `Cyclic YAML alias "*${node.source}" cannot be inlined; omitted to break the cycle`,
        severity: "warning",
        code: "cyclic-alias",
        source: "bundler",
        range: rangeOfNode(doc, node),
      });
      return undefined;
    }
    ctx.aliasStack.add(target);
    const converted = convertValue(ctx, doc, target, hint, literal);
    ctx.aliasStack.delete(target);
    return converted;
  }

  if (isMap(node)) {
    const refPair = literal ? undefined : findRefPair(node);
    if (refPair) return convertRef(ctx, doc, node, refPair, hint);

    const out: Record<string, unknown> = {};
    for (const pair of node.items) {
      const key = keyToString(pair.key);
      const value = pair.value;
      if (!isNode(value)) {
        out[key] = value;
        continue;
      }
      if (!literal && isLiteralDataKey(key, value)) {
        out[key] = convertValue(ctx, doc, value, hint, true);
        continue;
      }
      // Once inside literal data, the structural key-hints below (which route real OpenAPI
      // fields like "schema"/"properties"/"paths" to their ref-lifting/section logic) no longer
      // apply — a key of that name here is just user data that happens to share it. Recurse
      // generically, keeping the literal flag set for the rest of the subtree.
      if (literal) {
        out[key] = convertValue(ctx, doc, value, hint, true);
        continue;
      }
      switch (key) {
        case "paths":
          out[key] = convertPathsMap(ctx, doc, value);
          break;
        case "schema":
        case "items":
        case "additionalProperties":
        case "not":
          out[key] = convertValue(ctx, doc, value, "schemas");
          break;
        case "properties":
        case "schemas":
          out[key] = mapChildren(ctx, doc, value, "schemas");
          break;
        case "allOf":
        case "oneOf":
        case "anyOf":
          out[key] = isSeq(value) ? value.items.filter(isNode).map((item) => convertValue(ctx, doc, item, "schemas")) : convertValue(ctx, doc, value, "schemas");
          break;
        case "requestBody":
          out[key] = convertValue(ctx, doc, value, "requestBodies");
          break;
        case "requestBodies":
          out[key] = mapChildren(ctx, doc, value, "requestBodies");
          break;
        case "parameters":
          if (isSeq(value)) out[key] = value.items.filter(isNode).map((item) => convertValue(ctx, doc, item, "parameters"));
          else out[key] = mapChildren(ctx, doc, value, "parameters");
          break;
        case "responses":
          out[key] = mapChildren(ctx, doc, value, "responses");
          break;
        case "headers":
          out[key] = mapChildren(ctx, doc, value, "headers");
          break;
        case "examples":
          out[key] = mapChildren(ctx, doc, value, "examples");
          break;
        case "links":
          out[key] = mapChildren(ctx, doc, value, "links");
          break;
        case "callbacks":
          out[key] = mapChildren(ctx, doc, value, "callbacks");
          break;
        case "securitySchemes":
          out[key] = mapChildren(ctx, doc, value, "securitySchemes");
          break;
        default:
          out[key] = convertValue(ctx, doc, value, hint);
      }
    }
    return out;
  }

  if (isSeq(node)) {
    return node.items.filter(isNode).map((item) => convertValue(ctx, doc, item, hint, literal));
  }

  if (isScalar(node)) return node.value;

  return undefined;
}

/**
 * Bundle a workspace graph into a single, self-contained OpenAPI document: every external `$ref`
 * is lifted into `components/<section>` (or, for Path Item Object refs, inlined in place — OpenAPI
 * 3.0 has no `components/pathItems`), refs are rewritten to point within the output, and name
 * conflicts are resolved deterministically. Pure: no I/O, never throws.
 */
export function bundle(graph: WorkspaceGraph, options: BundleOptions = {}): BundleResult {
  const format = options.format ?? "yaml";
  const dereference = options.dereference ?? false;
  const diagnostics: Diagnostic[] = [];
  const entryDoc = graph.documents.get(graph.entryPath);
  if (!entryDoc) return { output: "", diagnostics };

  const root = entryDoc.yamlDoc.contents;
  if (!isNode(root) || !isMap(root)) return { output: "", diagnostics };

  const ctx: BundleContext = {
    graph,
    entryDoc,
    diagnostics,
    identityMap: new Map(),
    usedNames: new Map(),
    componentsOutput: {},
    dereference,
    expansionStack: new Set(),
    cycleAssignments: new Map(),
    visitedEntryIdentities: new Set(),
    aliasStack: new Set(),
  };

  const componentsPair = root.items.find((p) => keyToString(p.key) === "components");
  if (componentsPair && isNode(componentsPair.value)) {
    reserveEntryComponentNames(ctx, componentsPair.value);
  }

  const out: Record<string, unknown> = {};
  let componentsInserted = false;

  for (const pair of root.items) {
    const key = keyToString(pair.key);
    const value = pair.value;
    if (!isNode(value)) {
      out[key] = value;
      continue;
    }
    if (key === "components") {
      if (dereference) {
        // Reconciled after the full document is walked (below): in --dereference mode,
        // components reachable only via a $ref are inlined and dropped, so we need to know what
        // was actually visited before deciding what to keep verbatim.
        continue;
      }
      const converted = convertValue(ctx, entryDoc, value, undefined) as Record<string, unknown>;
      for (const [section, sectionValue] of Object.entries(converted)) {
        Object.assign(ensureSectionObject(ctx, section), sectionValue as Record<string, unknown>);
      }
      out.components = ctx.componentsOutput;
      componentsInserted = true;
      continue;
    }
    if (key === "paths") {
      out[key] = convertPathsMap(ctx, entryDoc, value);
      continue;
    }
    out[key] = convertValue(ctx, entryDoc, value, undefined);
  }

  if (dereference && componentsPair && isNode(componentsPair.value)) {
    addUnreferencedEntryComponents(ctx, componentsPair.value);
  }

  if (!componentsInserted && Object.keys(ctx.componentsOutput).length > 0) {
    out.components = ctx.componentsOutput;
  }

  const output = format === "json" ? `${JSON.stringify(out, null, 2)}\n` : yamlStringify(out);

  return { output, diagnostics };
}

/**
 * In `--dereference` mode, add back entry-document components that were never reached by any
 * `$ref` during dereferencing (and aren't already present as a cycle-participant slot) — bundle
 * never silently drops user content, so these are kept verbatim under their original names.
 */
function addUnreferencedEntryComponents(ctx: BundleContext, componentsNode: Node): void {
  if (!isMap(componentsNode)) return;
  for (const sectionPair of componentsNode.items) {
    const section = keyToString(sectionPair.key);
    if (!isNode(sectionPair.value) || !isMap(sectionPair.value)) continue;
    for (const entryPair of sectionPair.value.items) {
      if (!isNode(entryPair.value)) continue;
      const name = keyToString(entryPair.key);
      const pointer = formatPointer(["components", section, name]);
      const identityKey = `${ctx.entryDoc.filePath} ${pointer}`;
      if (ctx.visitedEntryIdentities.has(identityKey) || ctx.cycleAssignments.has(identityKey)) continue;

      const content = convertValue(ctx, ctx.entryDoc, entryPair.value, section);
      ensureSectionObject(ctx, section)[name] = content;
    }
  }
}
