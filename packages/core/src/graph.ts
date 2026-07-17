import { isNode } from "yaml";
import type { Node } from "yaml";
import { resolveAnchor } from "./anchor.ts";
import { nodeAtPointer } from "./document.ts";
import type { FileSystem } from "./filesystem.ts";
import { resolveFileReference } from "./filesystem.ts";
import { type OasisDocument, parseDocument } from "./parse.ts";
import { zeroRange } from "./position.ts";
import { findRefs, parseRefString } from "./ref.ts";
import type { FoundRef, OpenApiObjectKind } from "./ref.ts";
import type { Diagnostic, Range } from "./types.ts";
import { isExternalUriReference } from "./uri.ts";

export interface WorkspaceGraph {
  entryPath: string;
  /** All loaded documents, keyed by absolute path. */
  documents: Map<string, OasisDocument>;
  /** Graph-level diagnostics: load failures and $ref cycles. Per-document diagnostics live on
   * each OasisDocument (syntax errors, duplicate keys) and are not duplicated here. */
  diagnostics: Diagnostic[];
  fileSystem: FileSystem;
  /** Semantically reachable references, grouped by their owning document. */
  references: Map<string, FoundRef[]>;
}

/**
 * Load an entry document and transitively follow every semantic reference that points at another file,
 * building a workspace graph. Never throws: missing files and reference cycles are recorded as
 * diagnostics on the returned graph.
 */
export async function loadWorkspaceGraph(fs: FileSystem, entryPath: string): Promise<WorkspaceGraph> {
  const documents = new Map<string, OasisDocument>();
  const diagnostics: Diagnostic[] = [];
  const references = new Map<string, FoundRef[]>();
  const visiting = new Set<string>();
  // Negative cache: a path that already failed to load is not re-read (or re-diagnosed) for
  // every additional `$ref` site pointing at it — one attempt, one diagnostic per file.
  const failed = new Set<string>();

  async function loadFile(path: string, viaRefRange?: Range): Promise<OasisDocument | undefined> {
    const loaded = documents.get(path);
    if (loaded) return loaded;
    if (failed.has(path)) return undefined;

    let text: string;
    try {
      text = await fs.readFile(path);
    } catch (err) {
      failed.add(path);
      diagnostics.push({
        message: `Failed to load "${path}": ${err instanceof Error ? err.message : String(err)}`,
        severity: "error",
        code: "no-unresolved-ref",
        source: "core",
        range: viaRefRange ?? zeroRange(path),
      });
      return undefined;
    }

    const doc = parseDocument(text, path);
    documents.set(path, doc);
    return doc;
  }

  const scanned = new WeakMap<Node, Set<string>>();

  function markScanned(node: Node, kind?: OpenApiObjectKind): boolean {
    const key = kind ?? "document";
    let kinds = scanned.get(node);
    if (!kinds) {
      kinds = new Set<string>();
      scanned.set(node, kinds);
    }
    if (kinds.has(key)) return false;
    kinds.add(key);
    return true;
  }

  function recordRef(path: string, ref: FoundRef): void {
    const refs = references.get(path) ?? [];
    if (!refs.some((existing) =>
      existing.value === ref.value &&
      existing.range.startOffset === ref.range.startOffset &&
      existing.kind === ref.kind &&
      existing.targetKind === ref.targetKind
    )) refs.push(ref);
    references.set(path, refs);
  }

  async function scanScope(doc: OasisDocument, node: Node, kind?: OpenApiObjectKind): Promise<void> {
    if (!markScanned(node, kind)) return;
    const ownsVisit = !visiting.has(doc.filePath);
    if (ownsVisit) visiting.add(doc.filePath);

    for (const ref of findRefs(doc, node, kind)) {
      recordRef(doc.filePath, ref);
      const { filePart, pointer } = parseRefString(ref.value);
      // An absolute non-filesystem URI (`https:`, `urn:`, ...) is an external target the FileSystem
      // abstraction can't load — deliberately skipped here rather than turned into a bogus file
      // lookup. `resolveRef` reports it as an unsupported external reference when it's resolved.
      if (isExternalUriReference(filePart)) continue;

      const targetPath = filePart === "" ? doc.filePath : resolveFileReference(fs, doc.filePath, filePart);

      if (targetPath !== doc.filePath && visiting.has(targetPath)) {
        diagnostics.push({
          message: `Circular reference detected: "${doc.filePath}" -> "${targetPath}"`,
          severity: "warning",
          code: "no-ref-cycle",
          source: "core",
          range: ref.range,
        });
        continue;
      }

      const targetDoc = await loadFile(targetPath, ref.range);
      if (!targetDoc) continue;
      let targetNode: Node | undefined;
      if (pointer === "") {
        targetNode = isNode(targetDoc.yamlDoc.contents) ? targetDoc.yamlDoc.contents : undefined;
      } else if (pointer.startsWith("/")) {
        targetNode = nodeAtPointer(targetDoc, pointer)?.node;
      } else {
        targetNode = resolveAnchor(targetDoc, pointer)?.node;
      }
      if (targetNode) await scanScope(targetDoc, targetNode, ref.targetKind);
    }

    if (ownsVisit) visiting.delete(doc.filePath);
  }

  // Canonicalize the entry before traversal so it shares one identity with any path a `$ref`
  // resolves it to (`fs.resolve` always yields canonical paths). Otherwise a relative entry is
  // stored under its verbatim key while a back-reference reaches it under its absolute path — the
  // entry gets parsed twice and cycle detection misfires against the duplicate identity.
  const canonicalEntry = fs.canonicalize(entryPath);
  const entryDoc = await loadFile(canonicalEntry);
  if (entryDoc && isNode(entryDoc.yamlDoc.contents)) await scanScope(entryDoc, entryDoc.yamlDoc.contents);

  return { entryPath: canonicalEntry, documents, diagnostics, fileSystem: fs, references };
}

/** References discovered through the graph's semantic, target-scoped traversal. */
export function graphReferences(graph: WorkspaceGraph, doc: OasisDocument): readonly FoundRef[] {
  return graph.references.get(doc.filePath) ?? [];
}

/** All diagnostics in the graph: per-document parse diagnostics plus graph-level ones. */
export function allDiagnostics(graph: WorkspaceGraph): Diagnostic[] {
  const result: Diagnostic[] = [...graph.diagnostics];
  for (const doc of graph.documents.values()) {
    result.push(...doc.diagnostics);
  }
  return result;
}
