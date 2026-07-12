import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { nodeAtPointer } from "./document.ts";
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

/** Split a `$ref` string like "./other.yaml#/components/schemas/Foo" into its parts. */
export function parseRefString(ref: string): RefParts {
  const hashIdx = ref.indexOf("#");
  if (hashIdx === -1) return { filePart: ref, pointer: "" };
  return { filePart: ref.slice(0, hashIdx), pointer: ref.slice(hashIdx + 1) };
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

/** Find every `$ref: "..."` occurrence within a document's AST. */
export function findRefs(doc: OasisDocument): FoundRef[] {
  const cached = findRefsCache.get(doc);
  if (cached) return cached;

  const results: FoundRef[] = [];
  const root = doc.yamlDoc.contents;
  if (isNode(root)) walk(root);
  findRefsCache.set(doc, results);
  return results;

  function walk(node: Node): void {
    if (isMap(node)) {
      for (const pair of node.items) {
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
        if (isNode(value)) walk(value);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        if (isNode(item)) walk(item);
      }
    }
  }
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
