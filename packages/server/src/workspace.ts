import { loadWorkspaceGraph } from "@oasis/core";
import type { FileSystem, OasisDocument, WorkspaceGraph } from "@oasis/core";
import type { LintConfigFile } from "@oasis/linter";

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
  /**
   * The last successfully parsed config file content (`lint.rules`/`lint.overrides` included), so
   * `getDiagnosticsByFile` can resolve severities/overrides through the overlay without a second,
   * disk-only config read. Kept from the last *successful* parse: if the file is later edited into
   * invalid JSONC, this (and `entryPaths`) intentionally stay as the last-good values rather than
   * resetting, so an in-progress edit doesn't blank out a working project (see `loadProjectAtPath`).
   */
  configFile: LintConfigFile;
  /** Human-readable warnings about `entries` (e.g. an entry that doesn't exist on disk). */
  warnings: string[];
}

/**
 * Shared state for the LSP handlers: the (overlay) file system used to read documents, and a
 * cache of workspace graphs keyed by entry path. Outside of project mode, each open OpenAPI
 * document is treated as its own entry; the graph is rebuilt lazily and cached until a file it
 * contains changes. In project mode, entries declared in `oasis.config.jsonc` are additionally
 * loaded eagerly (see `packages/server/src/connection.ts`).
 *
 * Multiple projects can be loaded at once — one per discovered `oasis.config.jsonc` with a
 * non-empty `entries` field — keyed by that config file's resolved absolute path. A project can be
 * discovered either eagerly (root-of-workspace-folder scan, or `initializationOptions.configFiles`
 * from the client) or lazily (walking upward from an opened/changed document's directory; see
 * `discoverProjectUpward` in `packages/server/src/project.ts`).
 */
export interface ServerContext {
  fileSystem: FileSystem;
  graphCache: Map<string, WorkspaceGraph>;
  /** Loaded projects, keyed by the resolved absolute path of their `oasis.config.jsonc`. */
  projects: Map<string, ProjectState>;
  /** Workspace folder roots reported at initialize; bounds upward config discovery. */
  workspaceRoots: string[];
  /**
   * Directories already walked upward with no `oasis.config.jsonc` found (up to their workspace
   * boundary at the time), so repeated `didChange` events on a document outside any project don't
   * re-walk the filesystem on every keystroke. Cleared whenever a project is loaded or unloaded,
   * since that can change the answer for previously-missed directories.
   */
  upwardMissCache: Set<string>;
}

export function createServerContext(fileSystem: FileSystem): ServerContext {
  return {
    fileSystem,
    graphCache: new Map(),
    projects: new Map(),
    workspaceRoots: [],
    upwardMissCache: new Set(),
  };
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
 * If `path` is a member of any loaded project's entry graph, return that entry's absolute path
 * (loading the entry's graph, from cache if possible, to check membership). Projects are checked
 * in a deterministic order (by config path); within a project, entries are checked in declaration
 * order. The first graph containing `path` wins when a file belongs to more than one. Returns
 * undefined when no project is loaded, or when `path` belongs to no project graph.
 */
export async function findOwningEntry(ctx: ServerContext, path: string): Promise<string | undefined> {
  const configPaths = [...ctx.projects.keys()].sort();
  for (const configPath of configPaths) {
    const project = ctx.projects.get(configPath);
    if (!project) continue;
    for (const entryPath of project.entryPaths) {
      const graph = await getGraph(ctx, entryPath);
      if (graph.documents.has(path)) return entryPath;
    }
  }
  return undefined;
}

/**
 * The loaded `ProjectState` that declares `entryPath` as one of its own `entries` (not merely a
 * transitively-`$ref`'d member — see `findOwningEntry` for that), if any. Used to resolve the
 * `lint.rules`/`lint.overrides` that should apply when linting this entry's graph, straight from
 * already-loaded, overlay-aware project state rather than a second, disk-only config read.
 */
export function findProjectForEntry(ctx: ServerContext, entryPath: string): ProjectState | undefined {
  for (const project of ctx.projects.values()) {
    if (project.entryPaths.includes(entryPath)) return project;
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
