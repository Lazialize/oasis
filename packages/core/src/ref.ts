import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { nodeAtPointer } from "./document.ts";
import { resolveAlias } from "./walk.ts";
import { safeDecodeURIComponent } from "./pointer.ts";
import type { OasisDocument } from "./parse.ts";
import { rangeFromOffsets, zeroRange } from "./position.ts";
import type { Diagnostic, Range } from "./types.ts";
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
function isLiteralDataKey(key: string, value: Node): boolean {
  if (key === "examples") return isSeq(value);
  return key === "example" || key === "default" || key === "enum" || key === "const";
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
  // Two seen-sets (one per literal-context) so a shared anchor visited once under a literal-data
  // subtree doesn't suppress a later, genuine visit of the same node reached non-literally (or
  // vice versa) — each context is still bounded on its own against alias cycles/diamonds.
  const seenRefContext = new Set<Node>();
  const seenLiteralContext = new Set<Node>();

  function walk(node: Node, literal: boolean): void {
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
            const range = value.range;
            results.push({
              value: value.value,
              range: range
                ? rangeFromOffsets(doc.filePath, doc.lineCounter, range[0], range[1])
                : zeroRange(doc.filePath),
            });
          }
        }
      }
      for (const pair of resolved.items) {
        if (!isNode(pair.value)) continue;
        const keyStr = isScalar(pair.key) ? String(pair.key.value) : undefined;
        const childLiteral = literal || (keyStr !== undefined && isLiteralDataKey(keyStr, pair.value));
        walk(pair.value, childLiteral);
      }
    } else if (isSeq(resolved)) {
      for (const item of resolved.items) {
        if (isNode(item)) walk(item, literal);
      }
    }
  }

  if (isNode(root)) walk(root, false);
  findRefsCache.set(doc, results);
  return results;
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
  const targetPath = filePart === "" ? fromDoc.filePath : graph.fileSystem.resolve(fromDoc.filePath, filePart);
  const targetDoc = graph.documents.get(targetPath);
  const diagnosticRange = refRange ?? zeroRange(fromDoc.filePath);

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
