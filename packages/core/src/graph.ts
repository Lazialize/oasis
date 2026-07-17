import { fileURLToPath, pathToFileURL } from "node:url";
import { isNode } from "yaml";
import type { Node } from "yaml";
import { buildAnchorIndex, resolveAnchor } from "./anchor.ts";
import type { AnchorIndex, SchemaResourceEntry } from "./anchor.ts";
import { nodeAtFragmentPointerFrom, resourceBaseBeforeFragmentPointerTarget } from "./document.ts";
import type { FileSystem } from "./filesystem.ts";
import { type OasisDocument, parseDocument } from "./parse.ts";
import { rangeFromOffsets, zeroRange } from "./position.ts";
import { findRefs, parseRefString, resolveRef } from "./ref.ts";
import type { FoundRef, OpenApiObjectKind } from "./ref.ts";
import type { Diagnostic, Range } from "./types.ts";
import { resolveUriReference, stripUriFragment, uriScheme } from "./uri.ts";
import { detectVersion } from "./version.ts";
import { resolveAlias } from "./walk.ts";

export interface GraphResource extends SchemaResourceEntry {
  doc: OasisDocument;
  index: AnchorIndex;
  /** Effective base inside the resource; a retrieval alias may point at a root carrying `$id`. */
  baseUri: string;
}
export interface WorkspaceGraph {
  entryPath: string;
  documents: Map<string, OasisDocument>;
  diagnostics: Diagnostic[];
  fileSystem: FileSystem;
  references: Map<string, FoundRef[]>;
  /** Canonical JSON Schema resource URI -> physical source document/node. */
  resources: Map<string, GraphResource>;
}

export async function loadWorkspaceGraph(fs: FileSystem, entryPath: string): Promise<WorkspaceGraph> {
  const documents = new Map<string, OasisDocument>();
  const diagnostics: Diagnostic[] = [];
  const references = new Map<string, FoundRef[]>();
  const referenceOccurrences = new Map<string, FoundRef[]>();
  const resources = new Map<string, GraphResource>();
  const indexed = new Map<string, AnchorIndex>();
  const failed = new Set<string>();

  async function loadFile(path: string, viaRefRange?: Range): Promise<OasisDocument | undefined> {
    const canonicalPath = fs.canonicalize(path);
    const loaded = documents.get(canonicalPath);
    if (loaded) return loaded;
    if (failed.has(canonicalPath)) return undefined;
    let text: string;
    try { text = await fs.readFile(canonicalPath); }
    catch (err) {
      failed.add(canonicalPath);
      diagnostics.push({
        message: `Failed to load "${canonicalPath}": ${err instanceof Error ? err.message : String(err)}`,
        severity: "error", code: "no-unresolved-ref", source: "core", range: viaRefRange ?? zeroRange(canonicalPath),
      });
      return undefined;
    }
    const doc = parseDocument(text, canonicalPath);
    documents.set(canonicalPath, doc);
    return doc;
  }

  function indexDocument(doc: OasisDocument, schemaDocument: boolean): AnchorIndex {
    const key = `${doc.filePath}\u0000${schemaDocument}`;
    const cached = indexed.get(key);
    if (cached) return cached;
    const index = buildAnchorIndex(doc, { baseUri: pathToFileURL(doc.filePath).href, schemaDocument });
    const retrievalUri = pathToFileURL(doc.filePath).href;
    const root = doc.yamlDoc.contents;
    // Every loaded document has a retrieval resource even when it is an external OpenAPI object
    // rather than a standalone Schema Document. Schema indexing remains gated independently.
    if (!index.resources.has(retrievalUri) && isNode(root)) {
      const range = root.range
        ? rangeFromOffsets(doc.filePath, doc.lineCounter, root.range[0], root.range[1])
        : zeroRange(doc.filePath);
      index.resources.set(retrievalUri, { uri: retrievalUri, node: root, range, parentBaseUri: retrievalUri });
    }
    indexed.set(key, index);
    for (const entry of index.resources.values()) {
      const effectiveBase = entry.uri === retrievalUri
        ? [...index.resources.values()].find((candidate) => candidate.node === entry.node && candidate.uri !== retrievalUri)?.uri ?? entry.uri
        : entry.uri;
      // A document may first be reached as a generic OpenAPI object and later as a Schema Object.
      // Prefer the schema-aware index so its anchors/resources become available on the later walk.
      if (schemaDocument || !resources.has(entry.uri)) {
        resources.set(entry.uri, { ...entry, doc, index, baseUri: effectiveBase });
      }
    }
    return index;
  }

  const scanned = new WeakMap<Node, Set<string>>();
  function markScanned(node: Node, kind: OpenApiObjectKind | undefined, baseUri: string): boolean {
    const key = `${kind ?? "document"}\u0000${baseUri}`;
    let contexts = scanned.get(node);
    if (!contexts) { contexts = new Set(); scanned.set(node, contexts); }
    if (contexts.has(key)) return false;
    contexts.add(key);
    return true;
  }
  function recordRef(path: string, ref: FoundRef): void {
    const refs = references.get(path) ?? [];
    if (!refs.some((other) => other.value === ref.value && other.range.startOffset === ref.range.startOffset &&
      other.kind === ref.kind && other.targetKind === ref.targetKind && other.baseUri === ref.baseUri)) refs.push(ref);
    references.set(path, refs);

    const occurrences = referenceOccurrences.get(path) ?? [];
    if (!occurrences.some((other) => other.value === ref.value && other.range.startOffset === ref.range.startOffset &&
      other.kind === ref.kind && other.targetKind === ref.targetKind && other.baseUri === ref.baseUri &&
      other.sourceNode === ref.sourceNode)) occurrences.push(ref);
    referenceOccurrences.set(path, occurrences);
  }
  function targetScope(resource: GraphResource, pointer: string): { node: Node; baseUri: string } | undefined {
    if (pointer === "") return { node: resource.node, baseUri: resource.parentBaseUri };
    if (pointer.startsWith("/")) {
      const node = nodeAtFragmentPointerFrom(resource.doc, resource.node, pointer)?.node;
      return node
        ? {
          node,
          baseUri: resourceBaseBeforeFragmentPointerTarget(resource.doc, resource.node, pointer, resource.baseUri),
        }
        : undefined;
    }
    const anchor = resolveAnchor(resource.doc, pointer, resource.baseUri, resource.index);
    if (!anchor) return undefined;
    const anchoredResource = resource.index.resources.get(anchor.resourceUri);
    const baseUri = anchoredResource?.node === anchor.node
      ? anchoredResource.parentBaseUri
      : anchor.resourceUri;
    return { node: anchor.node, baseUri };
  }

  async function scanScope(doc: OasisDocument, node: Node, kind: OpenApiObjectKind | undefined, baseUri: string): Promise<void> {
    if (!markScanned(node, kind, baseUri)) return;
    indexDocument(doc, kind === "schema" && detectVersion(doc) === undefined);
    for (const ref of findRefs(doc, node, kind, baseUri)) {
      recordRef(doc.filePath, ref);
      const { pointer } = parseRefString(ref.value);
      const resourceUri = stripUriFragment(resolveUriReference(ref.baseUri, ref.value));
      let resource = resources.get(resourceUri);
      if (!resource) {
        if (uriScheme(resourceUri) !== "file") continue;
        let targetPath: string;
        try { targetPath = fs.canonicalize(fileURLToPath(resourceUri)); }
        catch { continue; }
        const targetDoc = await loadFile(targetPath, ref.range);
        if (!targetDoc) continue;
        indexDocument(targetDoc, ref.targetKind === "schema");
        resource = resources.get(resourceUri);
      }
      if (!resource) continue;
      const target = targetScope(resource, pointer);
      if (target) {
        await scanScope(resource.doc, target.node, ref.targetKind, target.baseUri);
      }
    }
  }

  const canonicalEntry = fs.canonicalize(entryPath);
  const entryDoc = await loadFile(canonicalEntry);
  if (entryDoc && isNode(entryDoc.yamlDoc.contents)) {
    indexDocument(entryDoc, false);
    await scanScope(entryDoc, entryDoc.yamlDoc.contents, undefined, pathToFileURL(entryDoc.filePath).href);
  }
  const graph = { entryPath: canonicalEntry, documents, diagnostics, fileSystem: fs, references, resources };
  detectReferenceCycles(graph, referenceOccurrences);
  return graph;
}

interface ReferenceEdge {
  target: ReferenceIdentity;
  range: Range;
}

interface ReferenceIdentity {
  node: Node;
  resourceUri: string;
}

/** Detect cycles between resolved reference targets, rather than between files that contain them. */
function detectReferenceCycles(graph: WorkspaceGraph, references: ReadonlyMap<string, readonly FoundRef[]>): void {
  const identities = new WeakMap<Node, Map<string, ReferenceIdentity>>();
  const identityFor = (node: Node, resourceUri: string): ReferenceIdentity => {
    let byResource = identities.get(node);
    if (!byResource) {
      byResource = new Map();
      identities.set(node, byResource);
    }
    let identity = byResource.get(resourceUri);
    if (!identity) {
      identity = { node, resourceUri };
      byResource.set(resourceUri, identity);
    }
    return identity;
  };
  const edges = new Map<ReferenceIdentity, ReferenceEdge[]>();

  for (const [path, refs] of references) {
    const doc = graph.documents.get(path);
    if (!doc) continue;
    for (const ref of refs) {
      if (!ref.sourceNode) continue;
      const result = resolveRef(graph, doc, ref);
      if (!result.ok) continue;
      const targetNode = resolveAlias(result.node, result.doc.yamlDoc);
      if (!targetNode) continue;
      const source = identityFor(ref.sourceNode, ref.baseUri);
      const target = identityFor(
        targetNode,
        result.resourceUri ?? pathToFileURL(result.doc.filePath).href,
      );
      const outgoing = edges.get(source) ?? [];
      outgoing.push({ target, range: ref.range });
      edges.set(source, outgoing);
    }
  }

  const visiting = new Set<ReferenceIdentity>();
  const visited = new Set<ReferenceIdentity>();

  function visit(identity: ReferenceIdentity): void {
    if (visited.has(identity)) return;
    visiting.add(identity);

    for (const edge of edges.get(identity) ?? []) {
      if (visiting.has(edge.target)) {
        graph.diagnostics.push({
          message: "Circular reference detected in resolved $ref target chain",
          severity: "warning",
          code: "no-ref-cycle",
          source: "core",
          range: edge.range,
        });
      } else {
        visit(edge.target);
      }
    }

    visiting.delete(identity);
    visited.add(identity);
  }

  for (const identity of edges.keys()) visit(identity);
}

export function graphReferences(graph: WorkspaceGraph, doc: OasisDocument): readonly FoundRef[] {
  return graph.references.get(doc.filePath) ?? [];
}
export function allDiagnostics(graph: WorkspaceGraph): Diagnostic[] {
  const result = [...graph.diagnostics];
  for (const doc of graph.documents.values()) result.push(...doc.diagnostics);
  return result;
}
