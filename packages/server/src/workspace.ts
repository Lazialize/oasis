import { loadWorkspaceGraph } from "@oasis/core";
import type { FileSystem, OasisDocument, WorkspaceGraph } from "@oasis/core";

/**
 * "Project mode" state: an `oasis.config.jsonc` with an `entries` field was found for the
 * workspace. Every file transitively reachable from one of these entries is a "project member" —
 * it gets diagnostics/definition/hover/completion from the owning entry's graph rather than being
 * treated as its own standalone entry.
 */
export interface ProjectState {
  /** Absolute path of the config file that declared the entries. */
  configPath: string;
  /** Directory containing the config file. */
  configDir: string;
  /** Absolute entry paths, in declaration order (first match wins for multi-graph membership). */
  entryPaths: string[];
  /** Human-readable warnings about `entries` (e.g. an entry that doesn't exist on disk). */
  warnings: string[];
}

/**
 * Shared state for the LSP handlers: the (overlay) file system used to read documents, and a
 * cache of workspace graphs keyed by entry path. Outside of project mode, each open OpenAPI
 * document is treated as its own entry; the graph is rebuilt lazily and cached until a file it
 * contains changes. In project mode, entries declared in `oasis.config.jsonc` are additionally
 * loaded eagerly (see `packages/server/src/connection.ts`).
 */
export interface ServerContext {
  fileSystem: FileSystem;
  graphCache: Map<string, WorkspaceGraph>;
  project: ProjectState | undefined;
}

export function createServerContext(fileSystem: FileSystem): ServerContext {
  return { fileSystem, graphCache: new Map(), project: undefined };
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

/**
 * If `path` is a member of a project entry's graph, return that entry's absolute path (loading
 * the entry's graph, from cache if possible, to check membership). Entries are checked in
 * declaration order; the first graph containing `path` wins when a file belongs to more than one.
 * Returns undefined outside of project mode, or when `path` belongs to no project graph.
 */
export async function findOwningEntry(ctx: ServerContext, path: string): Promise<string | undefined> {
  if (!ctx.project) return undefined;
  for (const entryPath of ctx.project.entryPaths) {
    const graph = await getGraph(ctx, entryPath);
    if (graph.documents.has(path)) return entryPath;
  }
  return undefined;
}

/**
 * The entry path whose graph should be used to serve LSP features for `path`: the owning project
 * entry if `path` is a project member, otherwise `path` itself (today's standalone-entry
 * behavior).
 */
export async function resolveEntryForPath(ctx: ServerContext, path: string): Promise<string> {
  return (await findOwningEntry(ctx, path)) ?? path;
}
