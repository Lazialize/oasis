import { pathToFileURL } from "node:url";
import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node, Scalar } from "yaml";
import { resolveAnchor } from "./anchor.ts";
import { nodeAtFragmentPointer, nodeAtFragmentPointerFrom, pointerToNode, resourceBaseAtFragmentPointer } from "./document.ts";
import { canonicalPointer } from "./pointer.ts";
import { resolveFileReference } from "./filesystem.ts";
import { containerExtensionsAreOpaque, isContainerKey, isLiteralDataKey } from "./node-context.ts";
import { containerEntryKind, directObjectKind } from "./semantic-traversal.ts";
import type { OpenApiObjectKind } from "./semantic-traversal.ts";
import { resolveAlias } from "./walk.ts";
import type { OasisDocument } from "./parse.ts";
import { rangeFromOffsets, zeroRange } from "./position.ts";
import type { Diagnostic, Range } from "./types.ts";
import { isExternalUriReference, resolveUriReference, stripUriFragment } from "./uri.ts";
import type { WorkspaceGraph } from "./graph.ts";
import { detectVersion } from "./version.ts";

export interface RefParts {
  /** File portion of the ref, "" for a same-document ref. */
  filePart: string;
  /** JSON Pointer portion of the ref (including leading "/"), "" for whole-document refs. */
  pointer: string;
}

/**
 * Split a `$ref` string like "./other%20v2.yaml#/components/schemas/Foo" into its raw URI parts.
 * Neither part is decoded here: URI classification must see the original file part (otherwise an
 * encoded colon in a relative filename can become an apparent scheme), and `parseFragmentPointer`
 * decodes fragment segments individually so an encoded `/` cannot become a pointer separator.
 */
export function parseRefString(ref: string): RefParts {
  const hashIdx = ref.indexOf("#");
  const filePart = hashIdx === -1 ? ref : ref.slice(0, hashIdx);
  const pointer = hashIdx === -1 ? "" : ref.slice(hashIdx + 1);
  return { filePart, pointer };
}

export { CONTAINER_KEYS, isContainerKey, isLiteralDataKey } from "./node-context.ts";

/**
 * Distinguishes a `discriminator.mapping` value that is a URI reference (e.g. "./dog.yaml#/Dog",
 * "../schemas/dog.yaml", "urn:example:dog", "#/components/schemas/Dog") from one that is a bare
 * component name (e.g. "Dog"), which OpenAPI's discriminator mapping also allows and which must be
 * left untouched — it names a schema under `components/schemas`, it isn't a place to load/rewrite.
 * Per the OpenAPI spec a mapping value is either a schema name or a URI reference; a *bare
 * component name* is a value matching `^[a-zA-Z0-9._-]+$` (so it contains neither a path separator
 * `/`, a scheme separator `:`, a fragment marker `#`, nor percent encoding). Anything else — a
 * relative path reference, an absolute URI (with or without `//`), a fragment, a percent-encoded
 * path — is a URI reference resolved with normal `$ref` semantics.
 */
export function looksLikeMappingRef(value: string): boolean {
  return !/^[a-zA-Z0-9._-]+$/.test(value);
}

export type ReferenceKind = "ref" | "dynamic-ref" | "discriminator-mapping";

export interface FoundRef {
  value: string;
  range: Range;
  /** The source scalar, retained for source-preserving subtree rewrites. */
  node: Scalar;
  /** The syntax that introduced this semantic reference. */
  kind: ReferenceKind;
  /** Semantic kind inherited by a referenced target reached from this Reference Object. */
  targetKind?: OpenApiObjectKind;
  /** Canonical JSON Schema base active at this exact walk occurrence. */
  baseUri: string;
  /** AST node that owns this reference, used internally to preserve resolved-target identity. */
  sourceNode?: Node;
}

/**
 * Find the semantic occurrence represented by a source scalar when its resource base is
 * unambiguous. A YAML alias can expose the same scalar under several bases; callers must not pick
 * one arbitrarily in that case, so this returns `undefined`.
 */
export function foundRefForNode(graph: WorkspaceGraph, doc: OasisDocument, node: Scalar): FoundRef | undefined {
  const matches = (graph.references.get(doc.filePath) ?? []).filter((ref) => ref.node === node);
  if (matches.length === 0) return undefined;
  const baseUri = matches[0]!.baseUri;
  return matches.every((ref) => ref.baseUri === baseUri) ? matches[0] : undefined;
}

/**
 * Cache of `findRefs` results, keyed by document identity. A full AST walk over a large document
 * is not free, and several independent lint rules (plus graph loading itself) each call
 * `findRefs` on every document in the workspace; memoizing avoids re-walking the same document
 * repeatedly within (and across) a single lint run. Keyed by the scoped root AST node and its
 * semantic object kind, so a re-parsed document naturally gets fresh entries and the same target
 * can safely be traversed in more than one semantic context.
 */
const findRefsCache = new WeakMap<Node, Map<string, FoundRef[]>>();

export type { OpenApiObjectKind } from "./semantic-traversal.ts";

const INHERITED_31_KINDS = new Set<OpenApiObjectKind>([
  "path-item",
  "operation",
  "parameter",
  "header",
  "request-body",
  "response",
  "media-type",
  "encoding",
  "callback",
  "schema",
]);

/**
 * Classify a named-entry container occurrence for `findRefs`. The kind→kind edges live in the shared
 * `containerEntryKind` table; the value-shape guards stay here because they depend on the resolved
 * node: a container value must be a map or sequence, and `examples`/`links` name Example/Link Object
 * maps only in their map form (a sequence-form `examples` is literal instance data).
 */
function namedEntryKind(
  key: string,
  value: Node,
  parentKind: OpenApiObjectKind | undefined,
  schema31: boolean,
  doc: OasisDocument,
): OpenApiObjectKind | undefined {
  const resolvedValue = resolveAlias(value, doc.yamlDoc);
  if (!resolvedValue || (!isMap(resolvedValue) && !isSeq(resolvedValue))) return undefined;
  if ((key === "examples" || key === "links") && !isMap(resolvedValue)) return undefined;
  return containerEntryKind(parentKind, key, schema31);
}

function isAnyValuedField(kind: OpenApiObjectKind | undefined, key: string): boolean {
  return (kind === "example" && key === "value") ||
    (kind === "link" && (key === "parameters" || key === "requestBody"));
}

/**
 * Find every semantic reference within a document's AST: OpenAPI/JSON Schema `$ref`,
 * `discriminator.mapping`, and `$dynamicRef` in 3.1 Schema Objects. Resolves `Alias` nodes to their
 * anchored targets as it descends (so refs reachable only through a `*alias` are still found), and
 * skips descent-tracked "literal data" subtrees (see `isLiteralDataKey`) so a `$ref`-shaped value
 * used as plain example/default/enum/const data isn't mistaken for a real reference.
 */
export function findRefs(
  doc: OasisDocument,
  scopeNode?: Node,
  scopeKind?: OpenApiObjectKind,
  initialBaseUri = pathToFileURL(doc.filePath).href,
): FoundRef[] {
  const root = scopeNode ?? doc.yamlDoc.contents;
  if (!isNode(root)) return [];
  const cacheKey = `${scopeKind ?? "document"}\u0000${initialBaseUri}`;
  const rootCache = findRefsCache.get(root);
  const cached = rootCache?.get(cacheKey);
  if (cached) return cached;

  const results: FoundRef[] = [];
  const version = detectVersion(doc);
  // A standalone target has no `openapi` field. It inherits 2020-12 schema-bearing semantics only
  // when the graph reaches it from a known 3.1 OpenAPI object scope.
  const schema31 = (scopeKind !== undefined && INHERITED_31_KINDS.has(scopeKind)) || version === "3.1";
  // A shared alias target may be reached with different semantic meanings. Keep a seen-set per
  // complete traversal context so one use as literal Example data cannot suppress another use as
  // a genuine Link or schema reference (and vice versa).
  const seenByContext = new Map<string, Set<Node>>();

  // `inContainer` marks that `node`'s own keys are user/spec-named entries (see `isContainerKey`),
  // so the literal-data key check is suppressed for them — an entry named `default`/`example` under
  // `responses`/`examples`/`properties`/... is a real object that may carry a genuine `$ref`.
  //
  // `isMappingObject` marks that `node` itself *is* a Discriminator Object's `mapping` map (not
  // just any map that happens to be reached via a key named "mapping" — a Schema Object property
  // named "mapping" is plain data, not a discriminator mapping). It's only ever set true for the
  // direct `mapping` child of a node reached via `isDiscriminatorObject`.
  function walk(
    node: Node,
    baseUri: string,
    literal: boolean,
    inContainer: boolean,
    extensionsOpaque: boolean,
    isMappingObject: boolean,
    isDiscriminatorObject = false,
    isComponentsObject = false,
    objectKind?: OpenApiObjectKind,
    entryKind?: OpenApiObjectKind,
  ): void {
    const resolved = resolveAlias(node, doc.yamlDoc);
    if (!resolved) return;
    let nodeBaseUri = baseUri;
    if (!literal && objectKind === "schema" && isMap(resolved)) {
      const idPair = resolved.items.find((pair) => isScalar(pair.key) && pair.key.value === "$id");
      if (isScalar(idPair?.value) && typeof idPair.value.value === "string") {
        nodeBaseUri = resolveUriReference(baseUri, idPair.value.value);
      }
    }
    const contextKey = [
      literal,
      inContainer,
      extensionsOpaque,
      isMappingObject,
      isDiscriminatorObject,
      isComponentsObject,
      objectKind,
      entryKind,
      nodeBaseUri,
    ].join(":");
    let seen = seenByContext.get(contextKey);
    if (!seen) {
      seen = new Set<Node>();
      seenByContext.set(contextKey, seen);
    }
    if (seen.has(resolved)) return;
    seen.add(resolved);

    if (isMap(resolved)) {
      if (!literal) {
        for (const pair of resolved.items) {
          const key = pair.key;
          const value = isNode(pair.value) ? resolveAlias(pair.value, doc.yamlDoc) ?? pair.value : pair.value;
          if (isScalar(key) && key.value === "$ref" && isScalar(value) && typeof value.value === "string") {
            const range = value.range;
            results.push({
              value: value.value,
              node: value,
              sourceNode: resolved,
              kind: "ref",
              targetKind: objectKind,
              baseUri: stripUriFragment(nodeBaseUri),
              range: range
                ? rangeFromOffsets(doc.filePath, doc.lineCounter, range[0], range[1])
                : zeroRange(doc.filePath),
            });
          }
          if (
            objectKind === "schema" &&
            isScalar(key) &&
            key.value === "$dynamicRef" &&
            isScalar(value) &&
            typeof value.value === "string"
          ) {
            const range = value.range;
            results.push({
              value: value.value,
              node: value,
              sourceNode: resolved,
              kind: "dynamic-ref",
              targetKind: "schema",
              baseUri: stripUriFragment(nodeBaseUri),
              range: range
                ? rangeFromOffsets(doc.filePath, doc.lineCounter, range[0], range[1])
                : zeroRange(doc.filePath),
            });
          }
        }
        // `discriminator.mapping` entries are references expressed as plain strings (e.g.
        // `dog: './dog.yaml#/Dog'`), not `{$ref}` objects, so they're invisible to the check above.
        // A bare component name (e.g. `dog: Dog`) is left alone (see `looksLikeMappingRef`).
        if (isMappingObject) {
          for (const pair of resolved.items) {
            const value = isNode(pair.value) ? resolveAlias(pair.value, doc.yamlDoc) ?? pair.value : pair.value;
            if (isScalar(value) && typeof value.value === "string" && looksLikeMappingRef(value.value)) {
              const range = value.range;
              results.push({
                value: value.value,
                node: value,
                sourceNode: value,
                kind: "discriminator-mapping",
                baseUri: stripUriFragment(nodeBaseUri),
                range: range
                  ? rangeFromOffsets(doc.filePath, doc.lineCounter, range[0], range[1])
                  : zeroRange(doc.filePath),
              });
            }
          }
        }
      }
      for (const pair of resolved.items) {
        if (!isNode(pair.value)) continue;
        // Container/literal semantics belong to the value exposed at this occurrence. An Alias is
        // only syntax, so classify its resolved target once and carry that same node into the walk.
        const contextualValue = resolveAlias(pair.value, doc.yamlDoc) ?? pair.value;
        const keyStr = isScalar(pair.key) ? String(pair.key.value) : undefined;
        const childLiteral = literal ||
          (keyStr !== undefined && isAnyValuedField(objectKind, keyStr)) ||
          (keyStr !== undefined &&
            ((extensionsOpaque && keyStr.startsWith("x-")) ||
              (!inContainer && isLiteralDataKey(keyStr, contextualValue))));
        // `!inContainer` (mirroring `childLiteral`): once we're inside a container, its entries are
        // user/spec-named (a component/property/status-code name), so an entry that happens to be
        // named like a container keyword (`parameters`, `headers`, `schemas`, ...) is a plain object
        // — NOT a nested container. Treating it as a container would wrongly suppress the literal-data
        // check one level down, so a `$ref`-shaped `example`/`default`/`enum`/`const` under it would
        // be mistaken for a real reference. A named object resets `inContainer`, so a genuine nested
        // container (e.g. `Schema.properties`) is still recognised on the next descent.
        const childEntryKind = !inContainer && !childLiteral && keyStr !== undefined
          ? namedEntryKind(keyStr, contextualValue, objectKind, schema31, doc)
          : undefined;
        const childContainer =
          !inContainer && !literal && keyStr !== undefined &&
          (isContainerKey(keyStr, contextualValue, version) || childEntryKind !== undefined);
        const childExtensionsOpaque = childContainer
          ? containerExtensionsAreOpaque(keyStr!, isComponentsObject)
          : true;
        // Only a `mapping` key reached as the *direct* child of a Discriminator Object counts —
        // an ordinary Schema Object property that happens to be named "mapping" (e.g.
        // `properties: { mapping: { type: string } }`) is plain data, not a discriminator mapping.
        const childIsMappingObject = !literal && isDiscriminatorObject && keyStr === "mapping" && isMap(contextualValue);
        const childIsDiscriminatorObject = !literal && keyStr === "discriminator" && isMap(contextualValue);
        const childIsComponentsObject =
          !literal && !inContainer && keyStr === "components" && isMap(contextualValue);
        const childObjectKind = childLiteral
          ? undefined
          : inContainer
            ? entryKind === "paths-map" || entryKind === "webhooks-map" ? "path-item" : entryKind
            : directObjectKind(objectKind, keyStr, schema31);
        // Leaving a Schema Object for an OpenAPI-only object (notably `discriminator`) also leaves
        // JSON Schema `$id` scope. URI-valued OpenAPI fields remain document-relative.
        const childBaseUri = objectKind === "schema" && childObjectKind !== "schema" && childEntryKind !== "schema"
          ? initialBaseUri
          : nodeBaseUri;
        walk(
          contextualValue,
          childBaseUri,
          childLiteral,
          childContainer,
          childExtensionsOpaque,
          childIsMappingObject,
          childIsDiscriminatorObject,
          childIsComponentsObject,
          childObjectKind,
          childEntryKind,
        );
      }
    } else if (isSeq(resolved)) {
      for (const item of resolved.items) {
        if (isNode(item)) walk(item, nodeBaseUri, literal, false, true, false, false, false, entryKind ?? objectKind);
      }
    }
  }

  const rootKind = scopeKind ?? (detectVersion(doc) !== undefined ? "root" : undefined);
  walk(root, initialBaseUri, false, false, true, false, false, false, rootKind);
  const cache = rootCache ?? new Map<string, FoundRef[]>();
  cache.set(cacheKey, results);
  if (!rootCache) findRefsCache.set(root, cache);
  return results;
}

/**
 * Find the source scalar for every genuine reference in `root`, using the same semantic traversal
 * as graph discovery. Literal Any-valued fields stay opaque, while Reference Objects and
 * discriminator mappings retain their exact source nodes for relocation edits.
 */
export function findSubtreeRefs(doc: OasisDocument, root: Node, scopeKind?: OpenApiObjectKind): Scalar[] {
  return findRefs(doc, root, scopeKind).map((ref) => ref.node);
}

export interface ResolvedRef {
  ok: true;
  doc: OasisDocument;
  node: Node;
  pointer: string;
  range: Range;
  /**
   * Canonical RFC 6901 pointer of the target *within its resource*, independent of the input
   * fragment's spelling: URI percent-encoding is decoded and an anchor is mapped to the pointer of
   * the node it names. Together with `resourceUri` this is the target's canonical identity, so two
   * URI-equivalent refs (percent-encoding variants, anchor vs pointer) deduplicate to one target.
   */
  canonicalPointer: string;
  /** Canonical JSON Schema resource containing the target, when known. */
  resourceUri?: string;
}

export interface UnresolvedRef {
  ok: false;
  diagnostic: Diagnostic;
}

export type ResolveRefResult = ResolvedRef | UnresolvedRef;

/**
 * Resolve a `$ref` string against the workspace graph, starting from `fromDoc`.
 * `refRange`, if given, is used as the diagnostic location on failure.
 */
export function resolveRef(
  graph: WorkspaceGraph,
  fromDoc: OasisDocument,
  ref: string | FoundRef,
  refRange?: Range,
): ResolveRefResult {
  const refString = typeof ref === "string" ? ref : ref.value;
  const { filePart, pointer } = parseRefString(refString);

  // A raw string is not itself an occurrence: it has no recorded resource scope of its own. Recover
  // that scope from matching graph occurrences instead of defaulting to `fromDoc`'s own base, which
  // would silently let the reference escape an `$id` resource it was discovered under. Aliased
  // scalars can expose the same value (and, when `refRange` is given, the same source range) under
  // several resource bases, so a value/range match is not a unique occurrence identity by itself —
  // when the matching occurrences disagree on `baseUri` the call is genuinely ambiguous and must fail
  // explicitly rather than silently picking one.
  let contextualRef: FoundRef | undefined;
  let ambiguousCandidates: FoundRef[] | undefined;
  if (typeof ref === "string") {
    const candidates = (graph.references.get(fromDoc.filePath) ?? []).filter((candidate) =>
      candidate.value === ref &&
      (!refRange ||
        (candidate.range.startOffset === refRange.startOffset && candidate.range.endOffset === refRange.endOffset))
    );
    if (candidates.length > 0) {
      const firstBaseUri = candidates[0]!.baseUri;
      if (candidates.every((candidate) => candidate.baseUri === firstBaseUri)) {
        contextualRef = candidates[0];
      } else {
        ambiguousCandidates = candidates;
      }
    }
  } else {
    contextualRef = ref;
  }

  const diagnosticRange = refRange ?? contextualRef?.range ?? ambiguousCandidates?.[0]?.range ?? zeroRange(fromDoc.filePath);

  if (ambiguousCandidates) {
    const scopes = [...new Set(ambiguousCandidates.map((candidate) => candidate.baseUri))];
    return {
      ok: false,
      diagnostic: {
        message: `Ambiguous reference: "${refString}" occurs under multiple resource scopes (${scopes.join(", ")}) and cannot be resolved from a raw string; resolve it using its FoundRef occurrence instead`,
        severity: "error",
        code: "no-unresolved-ref",
        source: "core",
        range: diagnosticRange,
      },
    };
  }

  const defaultBaseUri = pathToFileURL(fromDoc.filePath).href;
  // A raw string given without `refRange` (unlike the `FoundRef` path, and unlike a raw string
  // matched against a specific `refRange`) has always been allowed to fall back to plain
  // document-relative resolution. Preserve that for occurrences with no explicit resource scope
  // (an ordinary reference that never crossed an `$id` boundary) — only enforce the stricter
  // scope-bound behavior once a matching occurrence actually carries a non-default base, since
  // that's the case where silently escaping the scope would return the wrong target.
  const isRawStringWithoutRange = typeof ref === "string" && !refRange;
  const restrictToScope = contextualRef !== undefined &&
    (!isRawStringWithoutRange || contextualRef.baseUri !== defaultBaseUri);

  const baseUri = contextualRef?.baseUri ?? defaultBaseUri;
  const resolvedUri = resolveUriReference(baseUri, refString);
  const resourceUri = stripUriFragment(resolvedUri);
  const resource = graph.resources.get(resourceUri);

  if (resource) {
    if (pointer !== "" && !pointer.startsWith("/")) {
      // The resource-scoped anchor lookup above only sees anchors registered directly under
      // `resource`'s own base, not ones nested under a descendant `$id` reached from it. Retrying
      // unscoped (by name, across every indexed resource) is allowed for any raw string given
      // without `refRange` — even one whose matched occurrence carries a non-default resource base —
      // matching the leniency that call shape has always had. `FoundRef` calls and raw strings
      // matched via `refRange` keep the stricter scoped-only lookup.
      const anchor = resolveAnchor(resource.doc, pointer, resource.baseUri, resource.index) ??
        (!restrictToScope || isRawStringWithoutRange ? resolveAnchor(resource.doc, pointer, undefined, resource.index) : undefined);
      if (anchor) {
        return {
          ok: true,
          doc: resource.doc,
          node: anchor.node,
          pointer,
          canonicalPointer: pointerToNode(resource.doc, resource.node, anchor.node) ?? canonicalPointer(pointer),
          range: anchor.range,
          resourceUri: resource.baseUri,
        };
      }
    } else {
      const result = pointer === ""
        ? { node: resource.node, range: resource.range }
        : nodeAtFragmentPointerFrom(resource.doc, resource.node, pointer);
      if (result) {
        const targetBase = contextualRef?.targetKind === "schema" && pointer.startsWith("/")
          ? resourceBaseAtFragmentPointer(resource.doc, resource.node, pointer, resource.baseUri)
          : resource.baseUri;
        return { ok: true, doc: resource.doc, node: result.node, pointer, canonicalPointer: canonicalPointer(pointer), range: result.range, resourceUri: targetBase };
      }
    }
  }

  // The URI was claimed by more than one document (see `no-duplicate-schema-id` on `graph.diagnostics`).
  // Never fall through to picking one claimant by load order — report it as unresolved instead.
  if (graph.collidedResourceUris.has(resourceUri)) {
    return {
      ok: false,
      diagnostic: {
        message: `Unresolved reference: "${refString}" targets "${resourceUri}", which is declared as a canonical $id by more than one document; fix the duplicate $id to resolve this reference`,
        severity: "error",
        code: "no-unresolved-ref",
        source: "core",
        range: diagnosticRange,
      },
    };
  }

  // An absolute non-filesystem URI (`https:`, `urn:`, ...) is an external target, not a document in
  // the workspace graph. Report it explicitly instead of routing it through filesystem resolution.
  if (isExternalUriReference(resourceUri)) {
    return {
      ok: false,
      diagnostic: {
        message: `Unsupported external reference: "${refString}" targets an external URI scheme not resolved by the workspace`,
        severity: "error",
        code: "no-unresolved-ref",
        source: "core",
        range: diagnosticRange,
      },
    };
  }

  // A semantic occurrence has already supplied its canonical base. Falling back to `fromDoc` here
  // would silently resolve a different physical file when the resource-scoped target is missing.
  if (restrictToScope) {
    const detail = resource
      ? pointer !== "" && !pointer.startsWith("/")
        ? `anchor "#${pointer}" not found in "${resourceUri}"`
        : `pointer "${pointer || "/"}" not found in "${resourceUri}"`
      : `could not load "${refString}" (resolved to "${resourceUri}")`;
    return {
      ok: false,
      diagnostic: {
        message: `Unresolved reference: ${detail}`,
        severity: "error",
        code: "no-unresolved-ref",
        source: "core",
        range: diagnosticRange,
      },
    };
  }

  const targetPath =
    filePart === "" ? fromDoc.filePath : resolveFileReference(graph.fileSystem, fromDoc.filePath, filePart);
  const targetDoc = graph.documents.get(targetPath);

  if (!targetDoc) {
    return {
      ok: false,
      diagnostic: {
        message: `Unresolved reference: could not load "${refString}" (resolved to "${targetPath}")`,
        severity: "error",
        code: "no-unresolved-ref",
        source: "core",
        range: diagnosticRange,
      },
    };
  }

  // A fragment that is empty or begins with "/" is a JSON Pointer (RFC 6901). Anything else is a
  // JSON Schema 2020-12 plain-name anchor (`#anchor`), resolved through the target document's anchor
  // index — only 3.1 Schema Object contexts define anchors; a 3.0 document's index is empty.
  if (pointer !== "" && !pointer.startsWith("/")) {
    const anchor = resolveAnchor(targetDoc, pointer);
    if (!anchor) {
      return {
        ok: false,
        diagnostic: {
          message: `Unresolved reference: anchor "#${pointer}" not found in "${targetPath}"`,
          severity: "error",
          code: "no-unresolved-ref",
          source: "core",
          range: diagnosticRange,
        },
      };
    }
    const root = targetDoc.yamlDoc.contents;
    const canonical = isNode(root) ? pointerToNode(targetDoc, root, anchor.node) : undefined;
    return { ok: true, doc: targetDoc, node: anchor.node, pointer, canonicalPointer: canonical ?? canonicalPointer(pointer), range: anchor.range };
  }

  const result = nodeAtFragmentPointer(targetDoc, pointer);
  if (!result) {
    return {
      ok: false,
      diagnostic: {
        message: `Unresolved reference: pointer "${pointer || "/"}" not found in "${targetPath}"`,
        severity: "error",
        code: "no-unresolved-ref",
        source: "core",
        range: diagnosticRange,
      },
    };
  }

  return { ok: true, doc: targetDoc, node: result.node, pointer, canonicalPointer: canonicalPointer(pointer), range: result.range };
}
