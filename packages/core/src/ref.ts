import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node, Scalar } from "yaml";
import { resolveAnchor } from "./anchor.ts";
import { nodeAtPointer } from "./document.ts";
import { resolveFileReference } from "./filesystem.ts";
import { resolveAlias } from "./walk.ts";
import type { OasisDocument } from "./parse.ts";
import { rangeFromOffsets, zeroRange } from "./position.ts";
import type { Diagnostic, Range } from "./types.ts";
import { isExternalUriReference } from "./uri.ts";
import type { WorkspaceGraph } from "./graph.ts";
import {
  isNamedEntryContainer,
  NAMED_ENTRY_CONTAINER_KEYS,
  NAMED_ENTRY_CONTAINER_KEYS_31,
} from "./named-containers.ts";
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
 * encoded colon in a relative filename can become an apparent scheme), and `parsePointer` decodes
 * fragment segments individually so an encoded `/` cannot become a pointer separator.
 */
export function parseRefString(ref: string): RefParts {
  const hashIdx = ref.indexOf("#");
  const filePart = hashIdx === -1 ? ref : ref.slice(0, hashIdx);
  const pointer = hashIdx === -1 ? "" : ref.slice(hashIdx + 1);
  return { filePart, pointer };
}

/**
 * Keys whose value is arbitrary literal instance data (JSON Schema `example`/`default`/`enum`/
 * `const`) rather than a place `$ref` can legitimately point at: a `{"$ref": "..."}` appearing
 * inside is plain data, not a reference to follow. `examples` is ambiguous by name alone — as a
 * *sequence* it's the 3.1 JSON Schema `examples` keyword (literal instances, same as `example`),
 * but as a *map* it's an OpenAPI Media Type/Parameter/Header `examples` field (name -> Example
 * Object), whose entries may legitimately `$ref` into `components/examples` — so only the
 * sequence form is treated as literal data.
 */
export function isLiteralDataKey(key: string, value: Node): boolean {
  if (key === "examples") return isSeq(value);
  return key === "example" || key === "default" || key === "enum" || key === "const";
}

/**
 * Keys whose value is a map of *user/spec-named entries* (component names, HTTP status codes,
 * media types, property names, ...), not JSON Schema keywords. When descending into such a map,
 * the `isLiteralDataKey` check must NOT be applied to the entry names: an entry named `default`,
 * `example`, `enum`, etc. is an ordinary named object (a Response/Example/Schema Object that may
 * legitimately carry a real `$ref`), not literal instance data. `examples` qualifies only in its
 * *map* form (name -> Example Object); its *sequence* form is the JSON Schema literal keyword.
 */
/** @deprecated Use `NAMED_ENTRY_CONTAINER_KEYS` and `NAMED_ENTRY_CONTAINER_KEYS_31`. */
export const CONTAINER_KEYS = new Set<string>([
  ...NAMED_ENTRY_CONTAINER_KEYS,
  ...NAMED_ENTRY_CONTAINER_KEYS_31,
]);

/** @deprecated Use `isNamedEntryContainer`. */
export const isContainerKey = isNamedEntryContainer;

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

export interface FoundRef {
  value: string;
  range: Range;
  /** The source scalar, retained for source-preserving subtree rewrites. */
  node: Scalar;
  /** Semantic kind inherited by a referenced target reached from this Reference Object. */
  targetKind?: OpenApiObjectKind;
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

export type OpenApiObjectKind = "example" | "link";

function namedEntryKind(key: string, value: Node): OpenApiObjectKind | undefined {
  if (!isMap(value)) return undefined;
  if (key === "examples") return "example";
  if (key === "links") return "link";
  return undefined;
}

function isAnyValuedField(kind: OpenApiObjectKind | undefined, key: string): boolean {
  return (kind === "example" && key === "value") ||
    (kind === "link" && (key === "parameters" || key === "requestBody"));
}

/**
 * Find every `$ref: "..."` occurrence within a document's AST. Resolves `Alias` nodes to their
 * anchored targets as it descends (so refs reachable only through a `*alias` are still found), and
 * skips descent-tracked "literal data" subtrees (see `isLiteralDataKey`) so a `$ref`-shaped value
 * used as plain example/default/enum/const data isn't mistaken for a real reference.
 */
export function findRefs(doc: OasisDocument, scopeNode?: Node, scopeKind?: OpenApiObjectKind): FoundRef[] {
  const root = scopeNode ?? doc.yamlDoc.contents;
  if (!isNode(root)) return [];
  const cacheKey = scopeKind ?? "document";
  const rootCache = findRefsCache.get(root);
  const cached = rootCache?.get(cacheKey);
  if (cached) return cached;

  const results: FoundRef[] = [];
  const version = detectVersion(doc);
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
    literal: boolean,
    inContainer: boolean,
    isMappingObject: boolean,
    isDiscriminatorObject = false,
    objectKind?: OpenApiObjectKind,
    entryKind?: OpenApiObjectKind,
  ): void {
    const resolved = resolveAlias(node, doc.yamlDoc);
    if (!resolved) return;
    const contextKey = [literal, inContainer, isMappingObject, isDiscriminatorObject, objectKind, entryKind].join(":");
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
              targetKind: objectKind,
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
          (!inContainer && keyStr !== undefined && isLiteralDataKey(keyStr, contextualValue));
        // `!inContainer` (mirroring `childLiteral`): once we're inside a container, its entries are
        // user/spec-named (a component/property/status-code name), so an entry that happens to be
        // named like a container keyword (`parameters`, `headers`, `schemas`, ...) is a plain object
        // — NOT a nested container. Treating it as a container would wrongly suppress the literal-data
        // check one level down, so a `$ref`-shaped `example`/`default`/`enum`/`const` under it would
        // be mistaken for a real reference. A named object resets `inContainer`, so a genuine nested
        // container (e.g. `Schema.properties`) is still recognised on the next descent.
        const childContainer =
          !inContainer && !literal && keyStr !== undefined && isNamedEntryContainer(keyStr, contextualValue, version);
        // Only a `mapping` key reached as the *direct* child of a Discriminator Object counts —
        // an ordinary Schema Object property that happens to be named "mapping" (e.g.
        // `properties: { mapping: { type: string } }`) is plain data, not a discriminator mapping.
        const childIsMappingObject = !literal && isDiscriminatorObject && keyStr === "mapping" && isMap(contextualValue);
        const childIsDiscriminatorObject = !literal && keyStr === "discriminator" && isMap(contextualValue);
        const childObjectKind = inContainer ? entryKind : undefined;
        const childEntryKind = !inContainer && keyStr !== undefined ? namedEntryKind(keyStr, contextualValue) : undefined;
        walk(
          contextualValue,
          childLiteral,
          childContainer,
          childIsMappingObject,
          childIsDiscriminatorObject,
          childObjectKind,
          childEntryKind,
        );
      }
    } else if (isSeq(resolved)) {
      for (const item of resolved.items) {
        if (isNode(item)) walk(item, literal, false, false, false, objectKind);
      }
    }
  }

  walk(root, false, false, false, false, scopeKind);
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
  refString: string,
  refRange?: Range,
): ResolveRefResult {
  const { filePart, pointer } = parseRefString(refString);
  const diagnosticRange = refRange ?? zeroRange(fromDoc.filePath);

  // An absolute non-filesystem URI (`https:`, `urn:`, ...) is an external target, not a document in
  // the workspace graph. Report it explicitly instead of routing it through filesystem resolution.
  if (filePart !== "" && isExternalUriReference(filePart)) {
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
    return { ok: true, doc: targetDoc, node: anchor.node, pointer, range: anchor.range };
  }

  const result = nodeAtPointer(targetDoc, pointer);
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

  return { ok: true, doc: targetDoc, node: result.node, pointer, range: result.range };
}
