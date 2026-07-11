import { loadWorkspaceGraph } from "@oasis/core";
import type { FileSystem, OasisDocument, WorkspaceGraph } from "@oasis/core";

/**
 * Shared state for the LSP handlers: the (overlay) file system used to read documents, and a
 * cache of workspace graphs keyed by entry path. Each open OpenAPI document is treated as its own
 * entry; the graph is rebuilt lazily and cached until a file it contains changes.
 */
export interface ServerContext {
  fileSystem: FileSystem;
  graphCache: Map<string, WorkspaceGraph>;
}

export function createServerContext(fileSystem: FileSystem): ServerContext {
  return { fileSystem, graphCache: new Map() };
}

/** Load (or reuse a cached) workspace graph rooted at `entryPath`. */
export async function getGraph(ctx: ServerContext, entryPath: string): Promise<WorkspaceGraph> {
  const cached = ctx.graphCache.get(entryPath);
  if (cached) return cached;
  const graph = await loadWorkspaceGraph(ctx.fileSystem, entryPath);
  ctx.graphCache.set(entryPath, graph);
  return graph;
}

/**
 * Drop any cached graph that contains `path` as one of its documents, since its content changed.
 * Cheap and safe: the next `getGraph` call for an affected entry simply reloads everything.
 */
export function invalidateGraph(ctx: ServerContext, path: string): void {
  for (const [entryPath, graph] of ctx.graphCache) {
    if (entryPath === path || graph.documents.has(path)) {
      ctx.graphCache.delete(entryPath);
    }
  }
}

export function getDocument(graph: WorkspaceGraph, path: string): OasisDocument | undefined {
  return graph.documents.get(path);
}
