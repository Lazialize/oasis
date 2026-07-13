import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node, Scalar } from "yaml";
import type { OasisDocument } from "./parse.ts";
import { safeDecodeURIComponent } from "./pointer.ts";
import { rangeFromOffsets, zeroRange } from "./position.ts";
import type { Range } from "./types.ts";
import { detectVersion } from "./version.ts";
import { resolveAlias } from "./walk.ts";

/**
 * A named anchor collected from a 3.1 Schema Object: a `$anchor` or `$dynamicAnchor` keyword. The
 * `node` is the schema object the anchor names (the map the keyword sits in), with its source range
 * preserved so `#anchor` reference resolution stays traceable to a file + line/col.
 */
export interface AnchorEntry {
  name: string;
  node: Node;
  range: Range;
  /** True for `$dynamicAnchor` (indexed like a plain anchor here; runtime `$dynamicRef` semantics are out of scope). */
  dynamic: boolean;
  /**
   * The nearest enclosing `$id` scope (the raw `$id` value of the schema resource this anchor
   * belongs to), or `""` for the document-root resource. Recorded so scope-aware resolution and
   * collision reporting can be layered on later; lookup today is document-wide (see `resolveAnchor`).
   */
  scope: string;
}

export interface AnchorIndex {
  /** Anchors keyed by name; first definition wins on a duplicate name. */
  byName: Map<string, AnchorEntry>;
  entries: AnchorEntry[];
}

const anchorIndexCache = new WeakMap<OasisDocument, AnchorIndex>();

/** JSON Schema keywords whose value is literal instance data, so a `$anchor`-shaped string inside is not a keyword. */
function isLiteralSchemaDataKey(key: string, value: Node): boolean {
  if (key === "examples") return isSeq(value);
  return key === "example" || key === "default" || key === "enum" || key === "const";
}

function scalarString(node: unknown): string | undefined {
  return isScalar(node) && typeof (node as Scalar).value === "string" ? ((node as Scalar).value as string) : undefined;
}

/**
 * Build a per-document index of JSON Schema 2020-12 named anchors (`$anchor`, `$dynamicAnchor`) and
 * their enclosing `$id` scopes, for OpenAPI 3.1 documents. Returns an empty index for 3.0 documents
 * and OpenAPI Reference Object contexts, whose references are plain JSON References with no anchors.
 * Cached by document identity (a re-parsed document gets a fresh index), mirroring `findRefs`.
 */
export function buildAnchorIndex(doc: OasisDocument): AnchorIndex {
  const cached = anchorIndexCache.get(doc);
  if (cached) return cached;

  const index: AnchorIndex = { byName: new Map(), entries: [] };
  if (detectVersion(doc) !== "3.1") {
    anchorIndexCache.set(doc, index);
    return index;
  }

  const root = doc.yamlDoc.contents;
  const seen = new Set<Node>();

  function rangeOf(node: Node): Range {
    return node.range ? rangeFromOffsets(doc.filePath, doc.lineCounter, node.range[0], node.range[1]) : zeroRange(doc.filePath);
  }

  function record(name: string, holder: Node, dynamic: boolean, scope: string): void {
    const entry: AnchorEntry = { name, node: holder, range: rangeOf(holder), dynamic, scope };
    index.entries.push(entry);
    if (!index.byName.has(name)) index.byName.set(name, entry);
  }

  function walk(node: Node, scope: string, literal: boolean): void {
    const resolved = resolveAlias(node, doc.yamlDoc);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);

    if (isMap(resolved)) {
      // A schema resource's own `$id` opens a new base scope that its `$anchor`s belong to.
      const idScope = scalarString(resolved.items.find((p) => scalarString(p.key) === "$id")?.value);
      const nodeScope = idScope !== undefined ? idScope : scope;

      if (!literal) {
        for (const pair of resolved.items) {
          const key = scalarString(pair.key);
          if (key !== "$anchor" && key !== "$dynamicAnchor") continue;
          const name = scalarString(pair.value);
          if (name !== undefined) record(name, resolved, key === "$dynamicAnchor", nodeScope);
        }
      }

      for (const pair of resolved.items) {
        if (!isNode(pair.value)) continue;
        const key = scalarString(pair.key);
        const childLiteral = literal || (key !== undefined && isLiteralSchemaDataKey(key, pair.value));
        walk(pair.value, nodeScope, childLiteral);
      }
    } else if (isSeq(resolved)) {
      for (const item of resolved.items) {
        if (isNode(item)) walk(item, scope, literal);
      }
    }
  }

  if (isNode(root)) walk(root, "", false);
  anchorIndexCache.set(doc, index);
  return index;
}

/**
 * Resolve a plain-name fragment (`#anchor`, i.e. the part after `#` that is not a JSON Pointer) to
 * the schema object it names in `doc`. The fragment may be percent-encoded per URI syntax, so it is
 * percent-decoded before lookup. Returns `undefined` when no matching `$anchor`/`$dynamicAnchor`
 * exists (including for 3.0 documents, whose index is always empty).
 */
export function resolveAnchor(doc: OasisDocument, fragment: string): AnchorEntry | undefined {
  const name = safeDecodeURIComponent(fragment);
  return buildAnchorIndex(doc).byName.get(name);
}
