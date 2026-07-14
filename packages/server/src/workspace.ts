import { loadWorkspaceGraph } from "@oasis/core";
import type { FileSystem, OasisDocument, WorkspaceGraph } from "@oasis/core";
import { siblingExternalDocuments } from "@oasis/linter";
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
/** The `lint.rules`/`lint.overrides` config that governs a given entry path, plus where it came
 * from (see `resolveConfigForEntry` in `project.ts`, the single place this is computed). */
export interface ResolvedConfig {
  configFile: LintConfigFile;
  /** Absolute path of the config file this came from, or undefined if none was found. */
  configPath: string | undefined;
  /** Warnings to surface for this resolution (e.g. the nearest config file exists but fails to
   * parse as JSONC). Empty when nothing needs surfacing. */
  warnings: string[];
}

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
  /**
   * `resolveConfigForEntry` results for standalone (non-project-member) entries, keyed by entry
   * path, so repeated diagnostics publishes don't re-walk directories and re-parse JSONC on every
   * request. Cleared whenever a config file is loaded/reloaded (see `loadProjectAtPath`), since
   * that can change the answer for any standalone entry that resolves through it.
   */
  standaloneConfigCache: Map<string, ResolvedConfig>;
  /**
   * Paths of currently-open documents routed as standalone OpenAPI entries (see `routeDocument` in
   * `document-routing.ts`), so a config file change/delete can re-validate every standalone
   * document that might be governed by it — including override-only configs (no `entries` field)
   * that never register as a project and so wouldn't otherwise trigger a re-lint.
   */
  openStandaloneEntries: Set<string>;
  /**
   * The file membership (document paths) of each entry's graph as of its most recent successful
   * `getGraph` load, keyed by entry path. Unlike `graphCache`, `invalidateGraph` deliberately does
   * NOT clear this: it's a snapshot of "what did this entry's graph contain a moment ago", used by
   * `routeDocument` to notice that an edited `$ref`'d fragment (which has no owning project entry
   * and no `openapi:` key of its own, so it would otherwise route as `{kind: "ignored"}`) is still a
   * member of some open standalone entry's graph — even though that entry's cache was *just*
   * invalidated for this very same edit, moments before routing runs (see `handleDocumentEvent` in
   * `connection.ts`, which invalidates before routing). Self-heals on the next `getGraph` call for
   * that entry, whether or not the file is still a member after the edit.
   */
  lastGraphFiles: Map<string, Set<string>>;
  /**
   * Monotonic counter bumped on every graph invalidation (`invalidateGraph`, and the wholesale
   * `graphCache.clear()`s in `project.ts`). `getGraph` snapshots it before an async load and, if it
   * moved while the load was in flight, returns the graph *without caching it* — otherwise a slow
   * load started before an edit could finish after the invalidation and poison the cache with a
   * graph built from stale content (see issue #49).
   */
  graphEpoch: number;
}

export function createServerContext(fileSystem: FileSystem): ServerContext {
  return {
    fileSystem,
    graphCache: new Map(),
    projects: new Map(),
    workspaceRoots: [],
    upwardMissCache: new Set(),
    standaloneConfigCache: new Map(),
    openStandaloneEntries: new Set(),
    lastGraphFiles: new Map(),
    graphEpoch: 0,
  };
}

/** Load (or reuse a cached) workspace graph rooted at `entryPath`. */
export async function getGraph(ctx: ServerContext, entryPath: string): Promise<WorkspaceGraph> {
  const cached = ctx.graphCache.get(entryPath);
  if (cached) return cached;
  const epoch = ctx.graphEpoch;
  const graph = await loadWorkspaceGraph(ctx.fileSystem, entryPath);
  // An invalidation raced this load: the graph may have been built from content that changed
  // mid-load. Hand it to this caller (whose own staleness guard decides what to do with the
  // result — see `createValidationRunner` in `validation.ts`) but don't let it poison the cache
  // for later callers.
  if (ctx.graphEpoch !== epoch) return graph;
  ctx.graphCache.set(entryPath, graph);
  ctx.lastGraphFiles.set(entryPath, new Set(graph.documents.keys()));
  return graph;
}

/**
 * Entry paths from `entryPaths` whose most-recently-loaded graph (per `lastGraphFiles`, which
 * survives `invalidateGraph`) included `path` as a member. Used by `routeDocument` to find open
 * standalone entries that depend on a `$ref`'d fragment file being edited, even though that
 * fragment routes as `{kind: "ignored"}` on its own (no owning project entry, no `openapi:` key)
 * and its dependents' graph cache was just invalidated for this same edit. Deliberately reads the
 * last-known snapshot rather than reloading graphs here, so an edit to an ignored file doesn't
 * force an eager rebuild of every open standalone graph on every keystroke.
 */
export function findEntriesLastContaining(ctx: ServerContext, path: string, entryPaths: Iterable<string>): string[] {
  const result: string[] = [];
  for (const entryPath of entryPaths) {
    if (entryPath !== path && ctx.lastGraphFiles.get(entryPath)?.has(path)) result.push(entryPath);
  }
  return result;
}

/**
 * Drop any cached graph that contains `path` as one of its documents, since its content changed.
 * Cheap and safe: the next `getGraph` call for an affected entry simply reloads everything.
 */
export function invalidateGraph(ctx: ServerContext, path: string): void {
  // Bump unconditionally (not only when a cached graph is evicted): an *in-flight* load may be
  // reading `path` right now even though nothing for it is cached yet (see `getGraph`).
  ctx.graphEpoch++;
  for (const [entryPath, graph] of ctx.graphCache) {
    if (entryPath === path || graph.documents.has(path)) {
      ctx.graphCache.delete(entryPath);
    }
  }
}

export function getDocument(graph: WorkspaceGraph, path: string): OasisDocument | undefined {
  return graph.documents.get(path);
}

export interface DocContext {
  entryPath: string;
  graph: WorkspaceGraph;
  doc: OasisDocument;
}

/**
 * The common bootstrap most LSP feature handlers need: resolve `path`'s owning entry, load (or
 * reuse) that entry's graph, and fetch `path`'s own document from it. Returns undefined whenever
 * the document isn't in the graph (e.g. it was just deleted, or the graph load raced a change),
 * which every caller here treats as "nothing to do" for this request.
 */
export async function resolveDocContext(ctx: ServerContext, path: string): Promise<DocContext | undefined> {
  const entryPath = await resolveEntryForPath(ctx, path);
  const graph = await getGraph(ctx, entryPath);
  const doc = getDocument(graph, path);
  if (!doc) return undefined;
  return { entryPath, graph, doc };
}

/** Loaded projects in a deterministic order (by config path), so callers that need to pick a
 * single "owning" project among several candidates all agree on which one wins. Single source for
 * that ordering: `findOwningEntry` and `findProjectForEntry` both delegate to this. */
function sortedProjects(ctx: ServerContext): ProjectState[] {
  return [...ctx.projects.keys()].sort().map((configPath) => ctx.projects.get(configPath)!);
}

/**
 * If `path` is a member of any loaded project's entry graph, return that entry's absolute path
 * (loading the entry's graph, from cache if possible, to check membership). Projects are checked
 * in a deterministic order (`sortedProjects`); within a project, entries are checked in
 * declaration order. The first graph containing `path` wins when a file belongs to more than one.
 * Returns undefined when no project is loaded, or when `path` belongs to no project graph.
 */
export async function findOwningEntry(ctx: ServerContext, path: string): Promise<string | undefined> {
  for (const project of sortedProjects(ctx)) {
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
 *
 * Uses the same deterministic project ordering as `findOwningEntry` (`sortedProjects`), so the two
 * never disagree about which project "owns" an entry that (in some unusual config) is declared by
 * more than one.
 */
export function findProjectForEntry(ctx: ServerContext, entryPath: string): ProjectState | undefined {
  for (const project of sortedProjects(ctx)) {
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

/**
 * Every currently-loaded workspace graph: each project entry's graph (lazily (re)loaded if it was
 * evicted from the cache) plus any cached standalone graphs, deduplicated by graph identity. Unlike
 * `resolveEntryForPath`/`findOwningEntry` — which pick a single owning graph — this is for features
 * where *every* reaching graph matters (a file `$ref`'d by several entries lives in several graphs).
 */
export async function loadAllGraphs(ctx: ServerContext): Promise<WorkspaceGraph[]> {
  for (const project of ctx.projects.values()) {
    for (const entryPath of project.entryPaths) {
      if (!ctx.graphCache.has(entryPath)) await getGraph(ctx, entryPath);
    }
  }
  return [...new Set(ctx.graphCache.values())];
}

/**
 * Every loaded workspace graph whose document set includes `path`. A file `$ref`'d by more than one
 * project entry belongs to more than one graph; rename / find-references need all of them so a ref
 * living in a sibling entry's graph isn't missed (see `findOwningEntry`, which stops at the first).
 */
export async function findAllGraphsContaining(ctx: ServerContext, path: string): Promise<WorkspaceGraph[]> {
  return (await loadAllGraphs(ctx)).filter((graph) => graph.documents.has(path));
}

/**
 * The distinct documents (deduped by file path) across every loaded graph that contains
 * `targetPath`, each paired with one graph it belongs to so its `$ref`s can be resolved. Used by
 * rename / find-references: to find every `$ref` to a component, we must scan the documents of all
 * graphs that load the component's file — not just the first owning graph. Deduping by file path
 * means a document shared by two graphs (and therefore a shared `$ref`) is considered once, so the
 * same edit/location isn't produced twice.
 */
export async function referringDocumentsFor(
  ctx: ServerContext,
  targetPath: string,
): Promise<Array<{ doc: OasisDocument; graph: WorkspaceGraph }>> {
  const seen = new Set<string>();
  const result: Array<{ doc: OasisDocument; graph: WorkspaceGraph }> = [];
  for (const graph of await findAllGraphsContaining(ctx, targetPath)) {
    for (const doc of graph.documents.values()) {
      if (seen.has(doc.filePath)) continue;
      seen.add(doc.filePath);
      result.push({ doc, graph });
    }
  }
  return result;
}

/**
 * Documents from every *other* loaded graph that aren't already in `graph`, deduped by file path.
 * Fed to the lint engine as `externalDocuments` so a whole-workspace rule (`components/no-unused`)
 * counts usage from sibling project entries: a component in a shared file used only by entry B must
 * not be flagged unused when linting entry A's graph. The CLI never calls this, so a CLI lint of a
 * single entry graph keeps its existing whole-world semantics.
 */
export async function collectExternalDocuments(ctx: ServerContext, graph: WorkspaceGraph): Promise<OasisDocument[]> {
  return siblingExternalDocuments(graph, await loadAllGraphs(ctx));
}
