import { isAlias, isMap, isNode, isScalar, isSeq, stringify as yamlStringify } from "yaml";
import { pathToFileURL } from "node:url";
import type { Node, Pair, Scalar } from "yaml";
import {
  COMPONENT_SECTIONS,
  type Diagnostic,
  detectVersion,
  formatPointer,
  type FoundRef,
  graphReferences,
  isLiteralDataKey,
  isNamedEntryContainer,
  keyToString,
  looksLikeMappingRef,
  type OasisDocument,
  PreciseNumber,
  preserveNumericLiteral,
  type Range,
  type ResolvedRef,
  type WorkspaceGraph,
  parseFragmentPointer,
  parseRefString,
  rangeFromOffsets,
  resolveRef,
  resolveUriReference,
  stripUriFragment,
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

/**
 * Assign `value` at `key` as an own data property, immune to inherited accessors on
 * `Object.prototype` — most importantly the legacy `__proto__` setter. Every map the bundler
 * builds from untrusted, document-controlled keys (component names, schema property names,
 * literal payload keys, extension payload keys) must go through this instead of `obj[key] = value`:
 * a document that names something `__proto__` is common (it's a valid component name and a valid
 * arbitrary schema property name) and a plain assignment would silently drop the entry while
 * mutating the containing object's prototype instead of adding data.
 */
function setKey(obj: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

/** Copy every own enumerable property of `source` onto `target` via `setKey` (a `__proto__`-safe `Object.assign`). */
function assignKeys(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) setKey(target, key, source[key]);
}

function resolvedScalar(doc: OasisDocument, node: unknown): Scalar | undefined {
  if (!isNode(node)) return undefined;
  const resolved = isAlias(node) ? node.resolve(doc.yamlDoc) : node;
  return isScalar(resolved) ? resolved : undefined;
}

function findRefPair(doc: OasisDocument, node: Node): Pair | undefined {
  if (!isMap(node)) return undefined;
  return node.items.find(
    (p): p is Pair => {
      const value = resolvedScalar(doc, p.value);
      return keyToString(p.key) === "$ref" && value !== undefined && typeof value.value === "string";
    },
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
  /** Semantic ref occurrences grouped by their source scalar; aliases can contribute several bases. */
  refOccurrences: Map<Scalar, FoundRef[]>;
  refOccurrenceCursor: Map<Scalar, number>;
}

/** Resolve one Alias occurrence for a shape-sensitive conversion while sharing cycle diagnostics. */
function withAliasTarget<T>(
  ctx: BundleContext,
  doc: OasisDocument,
  node: Node,
  fallback: T,
  convert: (target: Node) => T,
): T {
  if (!isAlias(node)) return convert(node);
  const target = node.resolve(doc.yamlDoc);
  if (!target) {
    ctx.diagnostics.push({
      message: `Unresolved YAML alias "*${node.source}": no matching anchor`,
      severity: "warning",
      code: "unresolved-alias",
      source: "bundler",
      range: rangeOfNode(doc, node),
    });
    return fallback;
  }
  if (ctx.aliasStack.has(target)) {
    ctx.diagnostics.push({
      message: `Cyclic YAML alias "*${node.source}" cannot be inlined; omitted to break the cycle`,
      severity: "warning",
      code: "cyclic-alias",
      source: "bundler",
      range: rangeOfNode(doc, node),
    });
    return fallback;
  }
  ctx.aliasStack.add(target);
  try {
    return convert(target);
  } finally {
    ctx.aliasStack.delete(target);
  }
}

type OpenApiObjectKind = "example" | "link";

function objectKindForSection(section: string | undefined): OpenApiObjectKind | undefined {
  if (section === "examples") return "example";
  if (section === "links") return "link";
  return undefined;
}

function isAnyValuedField(kind: OpenApiObjectKind | undefined, key: string): boolean {
  return (kind === "example" && key === "value") ||
    (kind === "link" && (key === "parameters" || key === "requestBody"));
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
    setKey(ctx.componentsOutput, section, obj);
  }
  return obj;
}

/** Derive the components section a lifted value belongs in. `pointer` is a resolved `$ref` fragment. */
function deriveSection(pointer: string, hint: string | undefined): string {
  const segs = parseFragmentPointer(pointer);
  if (segs[0] === "components" && segs.length >= 2 && COMPONENT_SECTION_SET.has(segs[1] ?? "")) {
    return segs[1] as string;
  }
  return hint ?? "schemas";
}

/** Derive a deterministic, unique candidate name for a lifted value. `pointer` is a resolved `$ref` fragment. */
function deriveName(ctx: BundleContext, pointer: string, doc: OasisDocument, section: string): string {
  const segs = parseFragmentPointer(pointer);
  const raw = segs.length > 0 ? segs[segs.length - 1] ?? "" : fileStem(doc.filePath);
  const candidate = sanitizeName(raw === "" ? fileStem(doc.filePath) : raw);
  return uniqueName(candidate, ensureUsedNames(ctx, section));
}

/** Merge a map of already-defined component names (from the entry's own `components`) into `usedNames`. */
function reserveEntryComponentNames(ctx: BundleContext, componentsNode: Node): void {
  withAliasTarget(ctx, ctx.entryDoc, componentsNode, undefined, (resolvedComponents) => {
    if (!isMap(resolvedComponents)) return;
    for (const sectionPair of resolvedComponents.items) {
      const sectionName = keyToString(sectionPair.key);
      if (!isNode(sectionPair.value)) continue;
      withAliasTarget(ctx, ctx.entryDoc, sectionPair.value, undefined, (resolvedSection) => {
        if (!isMap(resolvedSection)) return;
        const set = ensureUsedNames(ctx, sectionName);
        for (const entryPair of resolvedSection.items) set.add(keyToString(entryPair.key));
      });
    }
  });
}

function mapChildren(
  ctx: BundleContext,
  doc: OasisDocument,
  mapNode: Node,
  hint: string,
  entryKind?: OpenApiObjectKind,
): Record<string, unknown> {
  return withAliasTarget(ctx, doc, mapNode, {}, (resolvedMap) => {
    if (!isMap(resolvedMap)) return convertValue(ctx, doc, resolvedMap, hint, false, entryKind) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const pair of resolvedMap.items) {
      if (!isNode(pair.value)) continue;
      setKey(out, keyToString(pair.key), convertValue(ctx, doc, pair.value, hint, false, entryKind));
    }
    return out;
  });
}

/** Convert one object member while preserving both OpenAPI Any fields and opaque payloads. */
function convertObjectMember(
  ctx: BundleContext,
  doc: OasisDocument,
  key: string,
  value: Node,
  hint: string | undefined,
): unknown {
  const objectKind = objectKindForSection(hint);
  const contextualValue = isAlias(value) ? value.resolve(doc.yamlDoc) ?? value : value;
  const literal =
    key.startsWith("x-") ||
    isLiteralDataKey(key, contextualValue) ||
    isAnyValuedField(objectKind, key);
  return convertValue(ctx, doc, value, hint, literal, objectKind);
}

/** Resolve `refPair`'s `$ref`, returning the resolution (or undefined + a recorded warning diagnostic). */
function nextRefOccurrence(ctx: BundleContext, scalar: Scalar): FoundRef | undefined {
  const refs = ctx.refOccurrences.get(scalar);
  if (!refs) return undefined;
  const cursor = ctx.refOccurrenceCursor.get(scalar) ?? 0;
  const ref = refs[cursor];
  if (ref) ctx.refOccurrenceCursor.set(scalar, cursor + 1);
  return ref;
}

function resolveRefPair(ctx: BundleContext, doc: OasisDocument, refPair: Pair): ReturnType<typeof resolveRef> {
  const scalar = resolvedScalar(doc, refPair.value)!;
  const refValue = scalar.value as string;
  const range = rangeOfScalar(doc, scalar);
  const occurrence = nextRefOccurrence(ctx, scalar);
  const result = resolveRef(ctx.graph, doc, occurrence ?? refValue, range);
  if (result.ok && occurrence) {
    const retrievalUri = pathToFileURL(doc.filePath).href;
    const targetResourceUri = result.resourceUri ?? stripUriFragment(resolveUriReference(occurrence.baseUri, occurrence.value));
    const targetRetrievalUri = pathToFileURL(result.doc.filePath).href;
    if (occurrence.baseUri !== retrievalUri || targetResourceUri !== targetRetrievalUri) {
      const unsupported: ReturnType<typeof resolveRef> = {
        ok: false,
        diagnostic: {
          message: `Schema reference "${refValue}" was preserved because bundling would relocate JSON Schema resource scope "${occurrence.baseUri}"`,
          severity: "error",
          code: "unsupported-schema-resource-relocation",
          source: "bundler",
          range,
        },
      };
      ctx.diagnostics.push({ ...unsupported.diagnostic, severity: "warning" });
      return unsupported;
    }
  }
  if (!result.ok) {
    ctx.diagnostics.push({ ...result.diagnostic, severity: "warning" });
  }
  return result;
}

/** Convert a `$ref`-bearing map: lift external targets into components/*, or pass through internal refs unchanged. */
function convertRef(ctx: BundleContext, doc: OasisDocument, mapNode: Node, refPair: Pair, hint: string | undefined): unknown {
  const scalar = resolvedScalar(doc, refPair.value)!;
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
    const content = convertValue(ctx, result.doc, result.node, section, false, objectKindForSection(section));
    setKey(ensureSectionObject(ctx, section), name, content);
  }

  return withSiblings(ctx, doc, mapNode, `#/components/${assigned.section}/${assigned.name}`, hint);
}

/**
 * Pick (or reuse) a `components/*` slot for a ref target that participates in a cycle. A ref that
 * points *exactly* at one of the entry document's own components (`/components/<section>/<name>`)
 * keeps that component's real name — the slot simply populates that same component, and its name is
 * already reserved in `usedNames`. Every other target — a cross-file ref, or an entry-document ref
 * whose pointer isn't itself a component (e.g. `/paths/~1x/get`) — gets a fresh unique name via the
 * same `deriveName`/`uniqueName` machinery lifted components use, so a cycle slot can never
 * overwrite an unrelated existing component (e.g. a schema whose name collides with the pointer's
 * sanitized tail). Returns whether the slot was newly created so the caller can emit exactly one
 * diagnostic per cycle site.
 */
function assignCycleSlot(
  ctx: BundleContext,
  result: ResolvedRef,
  hint: string | undefined,
): { assigned: { section: string; name: string }; isNew: boolean } {
  const identityKey = identityKeyOf(result);
  const existing = ctx.cycleAssignments.get(identityKey);
  if (existing) return { assigned: existing, isNew: false };

  const section = deriveSection(result.pointer, hint);
  const segs = parseFragmentPointer(result.pointer);
  const pointsAtEntryComponent =
    result.doc.filePath === ctx.entryDoc.filePath &&
    segs.length === 3 &&
    segs[0] === "components" &&
    COMPONENT_SECTION_SET.has(segs[1] ?? "");
  const name = pointsAtEntryComponent
    ? sanitizeName(segs[2] as string)
    : deriveName(ctx, result.pointer, result.doc, section);

  const assigned = { section, name };
  ctx.cycleAssignments.set(identityKey, assigned);
  return { assigned, isNew: true };
}

/** Merge sibling keys (alongside `$ref`) into an already-dereferenced value, converted with the same mode. */
function mergeSiblingsInto(ctx: BundleContext, doc: OasisDocument, mapNode: Node, content: unknown, hint: string | undefined): unknown {
  if (!isMap(mapNode)) return content;
  const siblingPairs = mapNode.items.filter((p) => keyToString(p.key) !== "$ref" && isNode(p.value));
  if (siblingPairs.length === 0) return content;

  const base: Record<string, unknown> =
    typeof content === "object" && content !== null && !Array.isArray(content) ? { ...(content as Record<string, unknown>) } : {};
  for (const pair of siblingPairs) {
    const key = keyToString(pair.key);
    setKey(base, key, convertObjectMember(ctx, doc, key, pair.value as Node, hint));
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
    const { assigned, isNew } = assignCycleSlot(ctx, result, hint);
    // One diagnostic per cycle target: a diamond can revisit the same cycle site repeatedly, but a
    // single deduplicated warning is emitted the first time the slot is allocated.
    if (isNew) {
      ctx.diagnostics.push({
        message: `Reference cycle detected: "${result.doc.filePath}#${result.pointer || "/"}" cannot be fully dereferenced; kept as "$ref: #/components/${assigned.section}/${assigned.name}" to break the cycle`,
        severity: "warning",
        code: "ref-cycle",
        source: "bundler",
        range: rangeOfScalar(doc, scalar),
      });
    }
    return withSiblings(ctx, doc, mapNode, `#/components/${assigned.section}/${assigned.name}`, hint);
  }

  ctx.expansionStack.add(identityKey);
  const content = convertValue(ctx, result.doc, result.node, hint, false, objectKindForSection(hint));
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
    setKey(out, key, convertObjectMember(ctx, doc, key, pair.value, hint));
  }
  return out;
}

/**
 * Convert a Path Item Object node, inlining any `$ref` (whole-file or fragment) instead of lifting
 * it into components — OpenAPI 3.0 has no `components/pathItems`, and inlining is simple and
 * consistent behavior for 3.1 too. Follows chained path-item refs with a depth guard for safety.
 */
function convertPathItem(ctx: BundleContext, doc: OasisDocument, node: Node, depth = 0): unknown {
  return withAliasTarget(ctx, doc, node, undefined, (resolvedNode) => {
    if (depth > 20) {
      // Never route a Path Item `$ref` through `convertValue`/`convertRef`: with no section hint it
      // would fall back to "schemas" (`deriveSection`) and lift a Path Item Object into
      // `components/schemas`, producing a malformed document. Leave the ref unresolved in place
      // and report it instead — core never throws for unresolved refs, and this mirrors that pattern.
      const refPair = findRefPair(doc, resolvedNode);
      if (refPair) {
        const scalar = resolvedScalar(doc, refPair.value)!;
        ctx.diagnostics.push({
          message: `Path Item "$ref" chain exceeds maximum depth (20); leaving "${scalar.value as string}" unresolved to avoid an incorrect bundle`,
          severity: "warning",
          code: "ref-depth-exceeded",
          source: "bundler",
          range: rangeOfScalar(doc, scalar),
        });
        return withPathItemSiblings(ctx, doc, resolvedNode, { $ref: scalar.value as string });
      }
      return convertValue(ctx, doc, resolvedNode, undefined);
    }

    const refPair = findRefPair(doc, resolvedNode);
    if (refPair) {
      const scalar = resolvedScalar(doc, refPair.value)!;
      const refValue = scalar.value as string;
      const result = resolveRefPair(ctx, doc, refPair);
      // 3.1 allows a Path Item `$ref` to carry siblings (`summary`/`description`); those override the
      // target's own per 3.1 Reference Object semantics, same as `withSiblings`/`mergeSiblingsInto`
      // do for non-path-item refs. Merge them in on both resolved and unresolved branches.
      if (!result.ok) return withPathItemSiblings(ctx, doc, resolvedNode, { $ref: refValue });
      const target = convertPathItem(ctx, result.doc, result.node, depth + 1);
      return withPathItemSiblings(ctx, doc, resolvedNode, target);
    }

    return convertValue(ctx, doc, resolvedNode, undefined);
  });
}

/** Merge a Path Item `$ref`'s sibling keys (e.g. `summary`, `description`) onto the inlined target. */
function withPathItemSiblings(ctx: BundleContext, doc: OasisDocument, node: Node, target: unknown): unknown {
  if (!isMap(node)) return target;
  const siblingPairs = node.items.filter((p) => keyToString(p.key) !== "$ref" && isNode(p.value));
  if (siblingPairs.length === 0) return target;

  const base: Record<string, unknown> =
    typeof target === "object" && target !== null && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const pair of siblingPairs) {
    const key = keyToString(pair.key);
    setKey(base, key, convertObjectMember(ctx, doc, key, pair.value as Node, undefined));
  }
  return base;
}

/**
 * Convert a map whose values are Path Item Objects — the shared shape behind `paths`, 3.1
 * root-level `webhooks`, and a Callback Object's runtime-expression entries. Each value is routed
 * through `convertPathItem` so a path-item `$ref` is inlined in place (never lifted into
 * `components`) while refs *inside* the inlined path item are lifted normally.
 */
function convertPathItemMap(
  ctx: BundleContext,
  doc: OasisDocument,
  mapNode: Node,
  extensionsOpaque: boolean,
): Record<string, unknown> {
  return withAliasTarget(ctx, doc, mapNode, {}, (resolvedMap) => {
    if (!isMap(resolvedMap)) return convertValue(ctx, doc, resolvedMap, undefined) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const pair of resolvedMap.items) {
      if (!isNode(pair.value)) continue;
      const key = keyToString(pair.key);
      // Paths and Callback Objects allow extensions, while Webhooks uses arbitrary entry names.
      setKey(
        out,
        key,
        extensionsOpaque && key.startsWith("x-")
          ? convertValue(ctx, doc, pair.value, undefined, true)
          : convertPathItem(ctx, doc, pair.value),
      );
    }
    return out;
  });
}

/**
 * Convert an operation's `callbacks` field: a map of name -> (Callback Object | Reference Object).
 * A `$ref` at `callbacks/<name>` is a reference to a whole Callback Object and is lifted into
 * `components/callbacks` like any other component. Otherwise the value is a Callback Object — a map
 * of runtime expression -> Path Item Object — whose entries must be treated as path items (via
 * `convertPathItemMap`), NOT as liftable components, so an external path-item `$ref` under an
 * expression key is inlined in place rather than lifted as a bare Path Item.
 */
function convertCallbacks(ctx: BundleContext, doc: OasisDocument, mapNode: Node): Record<string, unknown> {
  return withAliasTarget(ctx, doc, mapNode, {}, (resolvedMap) => {
    if (!isMap(resolvedMap)) return convertValue(ctx, doc, resolvedMap, "callbacks") as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const pair of resolvedMap.items) {
      const value = pair.value;
      if (!isNode(value)) continue;
      const converted = withAliasTarget(ctx, doc, value, {}, (resolvedValue) => {
        const refPair = findRefPair(doc, resolvedValue);
        // `$ref` at callbacks/<name>: lift the whole Callback Object into components/callbacks.
        return refPair
          ? convertRef(ctx, doc, resolvedValue, refPair, "callbacks")
          : convertPathItemMap(ctx, doc, resolvedValue, true);
      });
      setKey(out, keyToString(pair.key), converted);
    }
    return out;
  });
}

/** Convert an Operation's patterned Responses Object, preserving its `x-*` extension payloads. */
function convertResponses(ctx: BundleContext, doc: OasisDocument, mapNode: Node): Record<string, unknown> {
  return withAliasTarget(ctx, doc, mapNode, {}, (resolvedMap) => {
    if (!isMap(resolvedMap)) return convertValue(ctx, doc, resolvedMap, "responses") as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const pair of resolvedMap.items) {
      if (!isNode(pair.value)) continue;
      const key = keyToString(pair.key);
      setKey(
        out,
        key,
        key.startsWith("x-")
          ? convertValue(ctx, doc, pair.value, "responses", true)
          : convertValue(ctx, doc, pair.value, "responses"),
      );
    }
    return out;
  });
}

/**
 * Resolve a `discriminator.mapping` value that looks like a reference (see `looksLikeMappingRef`)
 * and compute the pointer it should be rewritten to in the bundled output: an unresolved value is
 * left unchanged (with a warning diagnostic, mirroring `resolveRefPair`), a same-document target
 * is rewritten to `#<pointer>`, and an external target is lifted into `components/<section>` using
 * the exact same `identityMap`/`deriveSection`/`deriveName` machinery `convertRef` uses for a
 * sibling `$ref` — so a mapping entry and an equivalent `oneOf` `$ref` pointing at the same target
 * always agree on the final pointer. Mapping entries can't hold inlined content (they're always a
 * bare string), so — unlike a sibling `$ref` in `--dereference` mode — external targets are always
 * lifted into `components/*`, never inlined, regardless of `ctx.dereference`.
 */
function resolveMappingRefTarget(ctx: BundleContext, doc: OasisDocument, value: Scalar, hint: string | undefined): string {
  const refValue = value.value as string;
  const range = rangeOfScalar(doc, value);
  const result = resolveRef(ctx.graph, doc, nextRefOccurrence(ctx, value) ?? refValue, range);
  if (!result.ok) {
    ctx.diagnostics.push({ ...result.diagnostic, severity: "warning" });
    return refValue;
  }

  if (result.doc.filePath === ctx.entryDoc.filePath) return `#${result.pointer}`;

  const identityKey = identityKeyOf(result);
  let assigned = ctx.identityMap.get(identityKey);
  if (!assigned) {
    const section = deriveSection(result.pointer, hint);
    const name = deriveName(ctx, result.pointer, result.doc, section);
    assigned = { section, name };
    // Register before recursing so ref cycles among lifted components terminate (mirrors `convertRef`).
    ctx.identityMap.set(identityKey, assigned);
    const content = convertValue(ctx, result.doc, result.node, section, false, objectKindForSection(section));
    setKey(ensureSectionObject(ctx, section), name, content);
  }
  return `#/components/${assigned.section}/${assigned.name}`;
}

/**
 * Convert a `discriminator.mapping` object: entries whose value looks like a reference (a schema
 * name URI or `$ref`-style pointer) are resolved and rewritten consistently with how the matching
 * sibling `oneOf`/`anyOf` `$ref` is rewritten; entries that are a bare component name are left
 * untouched, since they aren't a reference to load or rewrite.
 */
function convertDiscriminatorMapping(ctx: BundleContext, doc: OasisDocument, mapNode: Node): Record<string, unknown> {
  return withAliasTarget(ctx, doc, mapNode, {}, (resolvedMap) => {
    if (!isMap(resolvedMap)) return convertValue(ctx, doc, resolvedMap, "schemas") as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const pair of resolvedMap.items) {
      const value = pair.value;
      if (!isNode(value)) continue;
      const contextualValue = resolvedScalar(doc, value);
      if (contextualValue && typeof contextualValue.value === "string" && looksLikeMappingRef(contextualValue.value)) {
        setKey(out, keyToString(pair.key), resolveMappingRefTarget(ctx, doc, contextualValue, "schemas"));
      } else {
        setKey(out, keyToString(pair.key), convertValue(ctx, doc, value, "schemas"));
      }
    }
    return out;
  });
}

/**
 * Convert a YAML AST node into a plain JS value, lifting/rewriting `$ref`s as it goes. `literal`,
 * once set by descending under a key like `example`/`default`/`enum`/`const` (see
 * `isLiteralDataKey`), stays set for the rest of the subtree: a `$ref`-shaped map found there is
 * plain data, not a reference, and is copied through unchanged rather than lifted/rewritten.
 */
function convertValue(
  ctx: BundleContext,
  doc: OasisDocument,
  node: Node | undefined,
  hint: string | undefined,
  literal = false,
  objectKind?: OpenApiObjectKind,
  componentsObject = false,
): unknown {
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
    const converted = convertValue(ctx, doc, target, hint, literal, objectKind, componentsObject);
    ctx.aliasStack.delete(target);
    return converted;
  }

  if (isMap(node)) {
    const refPair = literal ? undefined : findRefPair(doc, node);
    if (refPair) return convertRef(ctx, doc, node, refPair, hint);

    const out: Record<string, unknown> = {};
    for (const pair of node.items) {
      const key = keyToString(pair.key);
      const value = pair.value;
      if (!isNode(value)) {
        setKey(out, key, value);
        continue;
      }
      // Shape-sensitive OpenAPI/JSON Schema classification must inspect the value exposed by an
      // Alias, while conversion still receives the Alias so cycle diagnostics and source identity
      // are preserved by the normal alias path.
      const contextualValue = isAlias(value) ? value.resolve(doc.yamlDoc) ?? value : value;
      // A Specification Extension (`x-*`) key introduces an opaque payload: everything below it is
      // arbitrary user data, so keys inside that happen to match OpenAPI structural fields
      // (`$ref`, `mapping`, `schema`, `properties`, `examples`, ...) must be copied through
      // unchanged, never interpreted as references to lift/rewrite. Descend with `literal` set.
      // (Extensions are allowed on almost every OpenAPI object; this switch only ever sees an
      // object's own member keys — user/spec-named container entries are routed via `mapChildren`
      // and never reach here — so an `x-` key here is always a real extension, not a data name.)
      if (!literal && key.startsWith("x-")) {
        setKey(out, key, convertValue(ctx, doc, value, hint, true));
        continue;
      }
      if (!literal && isLiteralDataKey(key, contextualValue)) {
        setKey(out, key, convertValue(ctx, doc, value, hint, true));
        continue;
      }
      if (!literal && isAnyValuedField(objectKind, key)) {
        out[key] = convertValue(ctx, doc, value, hint, true);
        continue;
      }
      // Once inside literal data, the structural key-hints below (which route real OpenAPI
      // fields like "schema"/"properties"/"paths" to their ref-lifting/section logic) no longer
      // apply — a key of that name here is just user data that happens to share it. Recurse
      // generically, keeping the literal flag set for the rest of the subtree.
      if (literal) {
        setKey(out, key, convertValue(ctx, doc, value, hint, true));
        continue;
      }
      switch (key) {
        case "paths":
          setKey(out, key, convertPathItemMap(ctx, doc, value, true));
          break;
        case "webhooks":
          setKey(out, key, convertPathItemMap(ctx, doc, value, false));
          break;
        case "schema":
        case "items":
        case "additionalProperties":
        case "not":
          setKey(out, key, convertValue(ctx, doc, value, "schemas"));
          break;
        case "properties":
        case "patternProperties":
        case "dependentSchemas":
        case "schemas":
        case "$defs":
        case "definitions":
          setKey(out, key, mapChildren(ctx, doc, value, "schemas"));
          break;
        case "allOf":
        case "oneOf":
        case "anyOf":
          setKey(
            out,
            key,
            isSeq(contextualValue)
              ? contextualValue.items.filter(isNode).map((item) => convertValue(ctx, doc, item, "schemas"))
              : convertValue(ctx, doc, value, "schemas"),
          );
          break;
        case "requestBody":
          setKey(out, key, convertValue(ctx, doc, value, "requestBodies"));
          break;
        case "requestBodies":
          setKey(out, key, mapChildren(ctx, doc, value, "requestBodies"));
          break;
        case "parameters":
          if (isSeq(contextualValue)) {
            setKey(out, key, contextualValue.items.filter(isNode).map((item) => convertValue(ctx, doc, item, "parameters")));
          }
          else setKey(out, key, mapChildren(ctx, doc, value, "parameters"));
          break;
        case "responses":
          setKey(
            out,
            key,
            componentsObject
              ? mapChildren(ctx, doc, value, "responses")
              : convertResponses(ctx, doc, value),
          );
          break;
        case "headers":
          setKey(out, key, mapChildren(ctx, doc, value, "headers"));
          break;
        case "examples":
          setKey(out, key, mapChildren(ctx, doc, value, "examples", "example"));
          break;
        case "links":
          setKey(out, key, mapChildren(ctx, doc, value, "links", "link"));
          break;
        case "callbacks":
          setKey(out, key, convertCallbacks(ctx, doc, value));
          break;
        case "securitySchemes":
          setKey(out, key, mapChildren(ctx, doc, value, "securitySchemes"));
          break;
        // 3.1-only `components/pathItems`: a map of name -> (Path Item Object | Reference Object).
        // Unlike a path-item `$ref` under `paths` (inlined in place — 3.0 has no pathItems section),
        // a whole-document `$ref` here IS a component reference and is lifted into
        // `components/pathItems` like any other component (never `components/schemas`). Refs *inside*
        // a lifted path item are lifted normally by the recursive `convertValue`.
        case "pathItems":
          setKey(out, key, mapChildren(ctx, doc, value, "pathItems"));
          break;
        // Maps of user/spec-named entries (not JSON Schema keywords): route through `mapChildren`
        // so an entry named `default`/`example`/`enum`/... is converted as a real object (and any
        // genuine `$ref` inside it is lifted/rewritten), never mistaken for literal instance data.
        // `hint` is passed through as the fallback lift section, matching the old default-case path.
        case "variables":
        case "encoding":
        case "scopes":
          setKey(out, key, mapChildren(ctx, doc, value, hint ?? "schemas"));
          break;
        // `discriminator.mapping` entries are references expressed as plain strings, not `{$ref}`
        // objects (see `convertDiscriminatorMapping`), so they need their own conversion path
        // instead of `mapChildren`'s generic per-entry `convertValue`.
        case "mapping":
          setKey(out, key, convertDiscriminatorMapping(ctx, doc, value));
          break;
        default:
          setKey(
            out,
            key,
            isNamedEntryContainer(key, contextualValue, detectVersion(doc) ?? detectVersion(ctx.entryDoc))
              ? mapChildren(ctx, doc, value, hint ?? "schemas")
              : convertValue(ctx, doc, value, hint),
          );
      }
    }
    return out;
  }

  if (isSeq(node)) {
    return node.items.filter(isNode).map((item) => convertValue(ctx, doc, item, hint, literal, objectKind, false));
  }

  if (isScalar(node)) {
    // Preserve numeric literals whose exact value the composed JS `Number` has rounded away
    // (integers past 2^53, high-precision/exponent decimals). `Scalar.source` retains the original
    // text; serialization emits it verbatim. Non-numeric scalars (and numbers that round-trip
    // exactly) pass through unchanged.
    if (typeof node.value === "number" && typeof node.source === "string") {
      return preserveNumericLiteral(node.value, node.source);
    }
    return node.value;
  }

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

  // A fragment-only `$dynamicRef` owned by the entry remains valid because its resource is not
  // relocated. Any external file part, or a fragment-only ref inside a schema lifted from another
  // document, can change dynamic scope during bundling. Preserve it verbatim, but diagnose the
  // unsupported relocation instead of silently claiming a semantics-preserving bundle.
  for (const doc of graph.documents.values()) {
    for (const ref of graphReferences(graph, doc)) {
      if (
        ref.kind !== "dynamic-ref" ||
        (parseRefString(ref.value).filePart === "" && doc.filePath === graph.entryPath)
      ) continue;
      diagnostics.push({
        message: `$dynamicRef "${ref.value}" from "${doc.filePath}" was preserved because its JSON Schema dynamic scope cannot be safely relocated during bundling`,
        severity: "warning",
        code: "unsupported-dynamic-ref",
        source: "bundler",
        range: ref.range,
      });
    }
  }

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
    refOccurrences: new Map(),
    refOccurrenceCursor: new Map(),
  };
  for (const doc of graph.documents.values()) {
    for (const ref of graphReferences(graph, doc)) {
      const occurrences = ctx.refOccurrences.get(ref.node) ?? [];
      occurrences.push(ref);
      ctx.refOccurrences.set(ref.node, occurrences);
    }
  }

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
      setKey(out, key, value);
      continue;
    }
    if (key === "components") {
      if (dereference) {
        // Reconciled after the full document is walked (below): in --dereference mode,
        // components reachable only via a $ref are inlined and dropped, so we need to know what
        // was actually visited before deciding what to keep verbatim.
        continue;
      }
      const converted = convertValue(ctx, entryDoc, value, undefined, false, undefined, true) as Record<string, unknown>;
      for (const section of Object.keys(converted)) {
        assignKeys(ensureSectionObject(ctx, section), converted[section] as Record<string, unknown>);
      }
      out.components = ctx.componentsOutput;
      componentsInserted = true;
      continue;
    }
    // `paths` and 3.1 root-level `webhooks` are both maps of Path Item Objects: path-item refs are
    // inlined in place (never lifted — 3.0 has no components/pathItems), refs inside them lifted
    // normally, and 3.1 summary/description siblings on a path-item ref preserved.
    if (key === "paths" || key === "webhooks") {
      setKey(out, key, convertPathItemMap(ctx, entryDoc, value, key === "paths"));
      continue;
    }
    setKey(
      out,
      key,
      key.startsWith("x-")
        ? convertValue(ctx, entryDoc, value, undefined, true)
        : convertValue(ctx, entryDoc, value, undefined),
    );
  }

  if (dereference && componentsPair && isNode(componentsPair.value)) {
    addUnreferencedEntryComponents(ctx, componentsPair.value);
  }

  if (!componentsInserted && Object.keys(ctx.componentsOutput).length > 0) {
    out.components = ctx.componentsOutput;
  }

  const output = serializeOutput(out, format);

  return { output, diagnostics };
}

// Placeholder tokens that both YAML and JSON emit as an ordinary scalar (letters/digits only, so
// YAML never quotes them and never reads them as numbers). Each serialization run draws a random
// base so document strings can't collide with a token; each occurrence is unique via the running
// index in the middle.
const PRECISE_TOKEN_PREFIX = "OASISPRECISENUMBER";
const PRECISE_TOKEN_SUFFIX = "PRESERVEDEND";

function randomTokenBase(): string {
  // base36, uppercased so the token stays purely alphanumeric; `|| "X"` guards the (theoretical)
  // Math.random() === 0 empty-string case.
  return `${PRECISE_TOKEN_PREFIX}${(Math.random().toString(36).slice(2).toUpperCase() || "X")}X`;
}

interface Substitution {
  token: string;
  source: string;
}

/**
 * Serialize the bundled document, splicing exact numeric literals back in. `PreciseNumber` values
 * can't survive `JSON.stringify`/yaml stringify (JSON would quote or reject them; yaml's number
 * stringifier re-rounds via `String(value)`), so each is first replaced with a unique placeholder
 * string and then the serialized placeholder is swapped for the raw literal. This keeps JSON output
 * from ever throwing on internal BigInt-style values and preserves the literal byte-for-byte in
 * both formats. If any document string happens to contain the run's random token base, a fresh
 * base is drawn and the substitution retried, so tokens can never collide with document content.
 */
function serializeOutput(out: Record<string, unknown>, format: "yaml" | "json"): string {
  let subs: Substitution[];
  let prepared: Record<string, unknown>;
  for (;;) {
    const state: SubstitutionState = { base: randomTokenBase(), subs: [], collided: false };
    const result = substitutePreciseNumbers(out, state) as Record<string, unknown>;
    if (!state.collided) {
      subs = state.subs;
      prepared = result;
      break;
    }
  }
  let text = format === "json" ? `${JSON.stringify(prepared, null, 2)}\n` : yamlStringify(prepared);
  for (const { token, source } of subs) {
    // Each token is unique, so a single (first-match) replace targets exactly its own insertion.
    // In JSON the placeholder is a quoted string; strip the quotes so the literal stays a number.
    text = format === "json" ? text.replace(`"${token}"`, source) : text.replace(token, source);
  }
  return text;
}

interface SubstitutionState {
  base: string;
  subs: Substitution[];
  /** Set when a document string contains `base`; the caller redraws the base and retries. */
  collided: boolean;
}

/** Deep-copy `value`, replacing every `PreciseNumber` with a unique placeholder token (recorded in `state.subs`). */
function substitutePreciseNumbers(value: unknown, state: SubstitutionState): unknown {
  if (value instanceof PreciseNumber) {
    const token = `${state.base}${state.subs.length}${PRECISE_TOKEN_SUFFIX}`;
    state.subs.push({ token, source: value.source });
    return token;
  }
  if (typeof value === "string") {
    if (value.includes(state.base)) state.collided = true;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => substitutePreciseNumbers(item, state));
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.includes(state.base)) state.collided = true;
      // `defineProperty` instead of `copy[key] = ...`: a plain assignment to a `__proto__` key
      // silently sets the prototype instead of an own property, dropping user data (#99).
      Object.defineProperty(copy, key, {
        value: substitutePreciseNumbers(child, state),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return copy;
  }
  return value;
}

/**
 * In `--dereference` mode, add back entry-document components that were never reached by any
 * `$ref` during dereferencing (and aren't already present as a cycle-participant slot) — bundle
 * never silently drops user content, so these are kept verbatim under their original names.
 */
function addUnreferencedEntryComponents(ctx: BundleContext, componentsNode: Node): void {
  // Decide membership in a fixed pass over the post-walk reachability state *before* emitting any
  // component. Serializing a preserved component dereferences its content, which can mark other
  // entry components visited; if that ran interleaved with the retain check (as it once did),
  // whether a component was kept depended on source order (#63). Snapshotting the set of
  // components to preserve first, then serializing, makes retention independent of declaration
  // order — semantically equivalent component maps always retain the same members.
  const toEmit: Array<{ section: string; name: string; value: Node }> = [];
  withAliasTarget(ctx, ctx.entryDoc, componentsNode, undefined, (resolvedComponents) => {
    if (!isMap(resolvedComponents)) return;
    for (const sectionPair of resolvedComponents.items) {
      const section = keyToString(sectionPair.key);
      if (!isNode(sectionPair.value)) continue;
      withAliasTarget(ctx, ctx.entryDoc, sectionPair.value, undefined, (resolvedSection) => {
        if (!isMap(resolvedSection)) return;
        for (const entryPair of resolvedSection.items) {
          if (!isNode(entryPair.value)) continue;
          const name = keyToString(entryPair.key);
          const pointer = formatPointer(["components", section, name]);
          const identityKey = `${ctx.entryDoc.filePath} ${pointer}`;
          if (ctx.visitedEntryIdentities.has(identityKey) || ctx.cycleAssignments.has(identityKey)) continue;
          toEmit.push({ section, name, value: entryPair.value });
        }
      });
    }
  });

  for (const { section, name, value } of toEmit) {
    const content = convertValue(ctx, ctx.entryDoc, value, section);
    setKey(ensureSectionObject(ctx, section), name, content);
  }
}
