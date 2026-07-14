import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node, Scalar } from "yaml";
import { resolveAnchor } from "./anchor.ts";
import { nodeAtPointer } from "./document.ts";
import { resolveAlias } from "./walk.ts";
import { safeDecodeURIComponent } from "./pointer.ts";
import type { OasisDocument } from "./parse.ts";
import { rangeFromOffsets, zeroRange } from "./position.ts";
import type { Diagnostic, Range } from "./types.ts";
import { isExternalUriReference } from "./uri.ts";
import type { WorkspaceGraph } from "./graph.ts";

export interface RefParts {
  /** File portion of the ref, "" for a same-document ref. */
  filePart: string;
  /** JSON Pointer portion of the ref (including leading "/"), "" for whole-document refs. */
  pointer: string;
}

/**
 * Split a `$ref` string like "./other%20v2.yaml#/components/schemas/Foo" into its parts. `$ref` is
 * a URI-reference, so the file part may be percent-encoded (e.g. a space as `%20`); it's decoded
 * here so the file system sees the real file name. The fragment/pointer part is left as-is —
 * `parsePointer` decodes each of its segments individually, since decoding the fragment as a whole
 * would collide with `/` used as the pointer's own segment separator.
 */
export function parseRefString(ref: string): RefParts {
  const hashIdx = ref.indexOf("#");
  const filePart = hashIdx === -1 ? ref : ref.slice(0, hashIdx);
  const pointer = hashIdx === -1 ? "" : ref.slice(hashIdx + 1);
  return { filePart: safeDecodeURIComponent(filePart), pointer };
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
export const CONTAINER_KEYS = new Set<string>([
  "responses",
  "properties",
  "patternProperties",
  "headers",
  "links",
  "callbacks",
  "variables",
  "mapping",
  "schemas",
  "parameters",
  "requestBodies",
  "securitySchemes",
  "encoding",
  "scopes",
  "$defs",
  "definitions",
]);

export function isContainerKey(key: string, value: Node): boolean {
  if (key === "examples") return isMap(value);
  return CONTAINER_KEYS.has(key);
}

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
}

/**
 * Cache of `findRefs` results, keyed by document identity. A full AST walk over a large document
 * is not free, and several independent lint rules (plus graph loading itself) each call
 * `findRefs` on every document in the workspace; memoizing avoids re-walking the same document
 * repeatedly within (and across) a single lint run. Keyed by the `OasisDocument` object itself,
 * so a re-parsed document (e.g. after an LSP edit) naturally gets a fresh, uncached entry.
 */
const findRefsCache = new WeakMap<OasisDocument, FoundRef[]>();

/**
 * Find every `$ref: "..."` occurrence within a document's AST. Resolves `Alias` nodes to their
 * anchored targets as it descends (so refs reachable only through a `*alias` are still found), and
 * skips descent-tracked "literal data" subtrees (see `isLiteralDataKey`) so a `$ref`-shaped value
 * used as plain example/default/enum/const data isn't mistaken for a real reference.
 */
export function findRefs(doc: OasisDocument): FoundRef[] {
  const cached = findRefsCache.get(doc);
  if (cached) return cached;

  const results: FoundRef[] = [];
  const root = doc.yamlDoc.contents;
  if (isNode(root)) {
    walkSubtreeRefs(doc, root, (value) => {
      const range = value.range;
      results.push({
        value: value.value as string,
        range: range ? rangeFromOffsets(doc.filePath, doc.lineCounter, range[0], range[1]) : zeroRange(doc.filePath),
      });
    });
  }
  findRefsCache.set(doc, results);
  return results;
}

/**
 * Find every genuine reference within the subtree rooted at `root`, returning the scalar value node
 * of each — both `{$ref: "..."}` values and `discriminator.mapping` URI values. Uses the exact same
 * literal-data, container, and discriminator semantics as `findRefs` (they share `walkSubtreeRefs`),
 * so a `$ref`-shaped scalar buried in `example`/`default`/`enum`/`const` literal data is *not*
 * returned, while a discriminator mapping URI *is*.
 *
 * `root` is assumed to sit in a normal Schema/Object context (non-literal, non-container,
 * non-mapping) — e.g. an inline schema or a `$ref` target being relocated. This is the counterpart
 * of `findRefs` for an arbitrary subtree rather than the whole document, and is not cached.
 */
export function findSubtreeRefs(doc: OasisDocument, root: Node): Scalar[] {
  const results: Scalar[] = [];
  walkSubtreeRefs(doc, root, (value) => results.push(value));
  return results;
}

/**
 * Shared semantic reference walk used by both `findRefs` and `findSubtreeRefs`. Invokes `onRef` with
 * the scalar value node of every genuine string reference discovered under `root`, resolving `Alias`
 * nodes to their anchored targets as it descends and skipping literal-data subtrees.
 */
function walkSubtreeRefs(doc: OasisDocument, root: Node, onRef: (value: Scalar) => void): void {
  // Two seen-sets (one per literal-context) so a shared anchor visited once under a literal-data
  // subtree doesn't suppress a later, genuine visit of the same node reached non-literally (or
  // vice versa) — each context is still bounded on its own against alias cycles/diamonds.
  const seenRefContext = new Set<Node>();
  const seenLiteralContext = new Set<Node>();

  // `inContainer` marks that `node`'s own keys are user/spec-named entries (see `isContainerKey`),
  // so the literal-data key check is suppressed for them — an entry named `default`/`example` under
  // `responses`/`examples`/`properties`/... is a real object that may carry a genuine `$ref`.
  //
  // `isMappingObject` marks that `node` itself *is* a Discriminator Object's `mapping` map (not
  // just any map that happens to be reached via a key named "mapping" — a Schema Object property
  // named "mapping" is plain data, not a discriminator mapping). It's only ever set true for the
  // direct `mapping` child of a node reached via `isDiscriminatorObject`.
  function walk(node: Node, literal: boolean, inContainer: boolean, isMappingObject: boolean, isDiscriminatorObject = false): void {
    const resolved = resolveAlias(node, doc.yamlDoc);
    if (!resolved) return;
    const seen = literal ? seenLiteralContext : seenRefContext;
    if (seen.has(resolved)) return;
    seen.add(resolved);

    if (isMap(resolved)) {
      if (!literal) {
        for (const pair of resolved.items) {
          const key = pair.key;
          const value = pair.value;
          if (isScalar(key) && key.value === "$ref" && isScalar(value) && typeof value.value === "string") {
            onRef(value);
          }
        }
        // `discriminator.mapping` entries are references expressed as plain strings (e.g.
        // `dog: './dog.yaml#/Dog'`), not `{$ref}` objects, so they're invisible to the check above.
        // A bare component name (e.g. `dog: Dog`) is left alone (see `looksLikeMappingRef`).
        if (isMappingObject) {
          for (const pair of resolved.items) {
            const value = pair.value;
            if (isScalar(value) && typeof value.value === "string" && looksLikeMappingRef(value.value)) {
              onRef(value);
            }
          }
        }
      }
      for (const pair of resolved.items) {
        if (!isNode(pair.value)) continue;
        const keyStr = isScalar(pair.key) ? String(pair.key.value) : undefined;
        const childLiteral = literal || (!inContainer && keyStr !== undefined && isLiteralDataKey(keyStr, pair.value));
        // `!inContainer` (mirroring `childLiteral`): once we're inside a container, its entries are
        // user/spec-named (a component/property/status-code name), so an entry that happens to be
        // named like a container keyword (`parameters`, `headers`, `schemas`, ...) is a plain object
        // — NOT a nested container. Treating it as a container would wrongly suppress the literal-data
        // check one level down, so a `$ref`-shaped `example`/`default`/`enum`/`const` under it would
        // be mistaken for a real reference. A named object resets `inContainer`, so a genuine nested
        // container (e.g. `Schema.properties`) is still recognised on the next descent.
        const childContainer =
          !inContainer && !literal && keyStr !== undefined && isContainerKey(keyStr, pair.value);
        // Only a `mapping` key reached as the *direct* child of a Discriminator Object counts —
        // an ordinary Schema Object property that happens to be named "mapping" (e.g.
        // `properties: { mapping: { type: string } }`) is plain data, not a discriminator mapping.
        const childIsMappingObject = !literal && isDiscriminatorObject && keyStr === "mapping" && isMap(pair.value);
        const childIsDiscriminatorObject = !literal && keyStr === "discriminator" && isMap(pair.value);
        walk(pair.value, childLiteral, childContainer, childIsMappingObject, childIsDiscriminatorObject);
      }
    } else if (isSeq(resolved)) {
      for (const item of resolved.items) {
        if (isNode(item)) walk(item, literal, false, false, false);
      }
    }
  }

  walk(root, false, false, false, false);
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

  const targetPath = filePart === "" ? fromDoc.filePath : graph.fileSystem.resolve(fromDoc.filePath, filePart);
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
