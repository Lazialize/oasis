import { dirname, join, resolve as pathResolve, sep } from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { CONFIG_FILE_NAME, expandGlobEntry, isGlobPattern, validateConfigShape } from "@oasis/linter";
import type { LintConfigFile } from "@oasis/linter";
import type { ProjectState, ResolvedConfig, ServerContext } from "./workspace.ts";
import { findProjectForEntry } from "./workspace.ts";

// Reads through `ctx.fileSystem` (the overlay FS) rather than node:fs directly, so this works
// uniformly against real disk and against InMemoryFileSystem in tests, and so unsaved edits to
// the config file itself are picked up without a save.

/** Result of reading+parsing a config file, distinguishing "doesn't exist" from "exists but is invalid JSONC" so callers can react differently (see `loadProjectAtPath`). */
export type ConfigReadResult =
  | { ok: true; configFile: LintConfigFile; warnings: string[] }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "parse-error"; message: string };

export async function readConfigFile(ctx: ServerContext, path: string): Promise<ConfigReadResult> {
  let text: string;
  try {
    text = await ctx.fileSystem.readFile(path);
  } catch {
    return { ok: false, reason: "missing" };
  }
  const errors: ParseError[] = [];
  parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    return {
      ok: false,
      reason: "parse-error",
      message: `Failed to parse ${CONFIG_FILE_NAME}: invalid JSONC (error code ${errors[0]?.error})`,
    };
  }
  // Syntactically valid JSONC can still have the wrong runtime shape (e.g. `lint.overrides` as an
  // object instead of an array), which callers previously assumed away; `validateConfigShape`
  // drops any such field and reports it instead of letting `resolveConfig`/`resolveEntries` crash
  // or silently misbehave on it (#33).
  const { configFile, diagnostics } = validateConfigShape(text, path);
  const warnings = diagnostics.map(
    (d) => `${d.message} (${CONFIG_FILE_NAME}:${d.range.start.line + 1}:${d.range.start.character + 1})`,
  );
  return { ok: true, configFile, warnings };
}

interface ResolvedProjectEntries {
  entries: string[];
  warnings: string[];
}

async function resolveProjectEntries(
  ctx: ServerContext,
  configPath: string,
  configFile: LintConfigFile,
): Promise<ResolvedProjectEntries> {
  const entries: string[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  const configDir = dirname(configPath);

  for (const raw of configFile.entries ?? []) {
    if (isGlobPattern(raw)) {
      // Glob expansion needs to enumerate directory contents, which the overlay `FileSystem`
      // interface (in-memory unsaved buffers over real disk) can't do. Config files only ever
      // live on disk in project mode, so expand straight against the real filesystem instead of
      // going through `ctx.fileSystem`.
      const matches = expandGlobEntry(raw, configDir);
      if (matches.length === 0) {
        warnings.push(`Entry glob "${raw}" in ${CONFIG_FILE_NAME} matched no files (resolved against "${configDir}"); skipping.`);
        continue;
      }
      for (const abs of matches) {
        if (seen.has(abs)) continue;
        seen.add(abs);
        entries.push(abs);
      }
      continue;
    }

    const abs = ctx.fileSystem.resolve(configPath, raw);
    if (seen.has(abs)) continue;
    try {
      await ctx.fileSystem.readFile(abs);
      seen.add(abs);
      entries.push(abs);
    } catch {
      // Unknown/missing entry: skip it rather than crashing project-mode startup, but still
      // surface it so it doesn't fail silently (see ProjectState.warnings).
      warnings.push(`Entry "${raw}" in ${CONFIG_FILE_NAME} not found (resolved to "${abs}"); skipping.`);
    }
  }
  return { entries, warnings };
}

function unloadProject(ctx: ServerContext, configPath: string): void {
  if (ctx.projects.delete(configPath)) {
    // Drop cached graphs and the upward-discovery negative cache: removing a project can change
    // membership/discovery answers for files that were previously resolved against it.
    ctx.graphEpoch++; // in-flight graph loads must not repopulate the cache (see getGraph)
    ctx.graphCache.clear();
    ctx.upwardMissCache.clear();
  }
}

/**
 * Load (or reload) the project defined by the `oasis.config.jsonc` at `rawConfigPath`.
 *
 * - If the file is missing, or parses fine but its `entries` field is empty or absent, any
 *   previously-loaded project at this config path is unloaded (removed from `ctx.projects`).
 * - If the file exists but fails to parse as JSONC (e.g. mid-edit), any previously-loaded project
 *   is kept as-is ("last-good"): a syntactically broken config shouldn't blank out a working
 *   project's entries/diagnostics while the user is still typing. The returned `ProjectState` in
 *   this case carries the parse error as its only warning (for `publishConfigWarnings`) without
 *   persisting that warning into `ctx.projects`, so it clears automatically once the file is valid
 *   again. If there was no previously-loaded project (including: this config never had entries, so
 *   it never registered one), a synthetic, unregistered `ProjectState` (empty `entryPaths`) is
 *   still returned so the parse-error warning reaches `publishConfigWarnings` instead of being
 *   silently dropped.
 *
 * Returns the resulting `ProjectState` (registered or, for a warning-only result, synthetic), or
 * undefined if there is nothing to report (no config, and nothing was ever loaded here).
 *
 * Safe to call for a path that was never a project (e.g. probing during upward discovery, or a
 * root-of-workspace scan where no config exists there): it's then a no-op.
 *
 * Always clears `ctx.standaloneConfigCache`: this function only runs in response to a config file
 * being created, changed, deleted, or newly discovered, and any of those can change which config
 * governs a standalone (non-project-member) entry — even one that resolves to a *different*
 * config file than `configPath`, e.g. when this file previously blocked upward discovery by
 * existing-but-being-broken and now no longer does. A full clear is simpler than tracking which
 * standalone entries this specific config affects, and reloads are rare enough that the cost is
 * negligible.
 */
export async function loadProjectAtPath(ctx: ServerContext, rawConfigPath: string): Promise<ProjectState | undefined> {
  const configPath = pathResolve(rawConfigPath);
  ctx.standaloneConfigCache.clear();
  const result = await readConfigFile(ctx, configPath);

  if (!result.ok) {
    if (result.reason === "missing") {
      unloadProject(ctx, configPath);
      return undefined;
    }
    // Parse error: keep the last-good project untouched, but surface the parse error as a
    // one-off warning on the returned (not stored) state.
    const existing = ctx.projects.get(configPath);
    if (existing) return { ...existing, warnings: [result.message] };
    // Never previously registered as a project (e.g. its first-ever load is already broken, or it
    // only ever set `lint.rules`/`lint.overrides` with no `entries`): still surface the warning.
    return { configPath, configDir: dirname(configPath), entryPaths: [], configFile: {}, warnings: [result.message] };
  }

  const { entries, warnings: entryWarnings } = await resolveProjectEntries(ctx, configPath, result.configFile);
  const warnings = [...result.warnings, ...entryWarnings];
  if (entries.length === 0) {
    unloadProject(ctx, configPath);
    if (warnings.length === 0) return undefined;
    return { configPath, configDir: dirname(configPath), entryPaths: [], configFile: result.configFile, warnings };
  }

  const state: ProjectState = {
    configPath,
    configDir: dirname(configPath),
    entryPaths: entries,
    configFile: result.configFile,
    warnings,
  };
  ctx.projects.set(configPath, state);
  // Drop cached graphs so a reload (e.g. the config file itself changed) picks up new entries, and
  // the upward-discovery cache so directories under this project are no longer treated as misses.
  ctx.graphEpoch++; // in-flight graph loads must not repopulate the cache (see getGraph)
  ctx.graphCache.clear();
  ctx.upwardMissCache.clear();
  return state;
}

/**
 * Search each workspace folder root (no deep scan) for `oasis.config.jsonc` and load it as a
 * project if it declares a non-empty `entries` list. This is one of two eager-discovery
 * mechanisms (the other being `initializationOptions.configFiles`, see `loadConfigFilesFromInit`);
 * both dedupe naturally since projects are keyed by resolved config path. By default this also
 * records `workspaceRoots` on the context so upward discovery (`discoverProjectUpward`) knows
 * where to stop walking; callers scanning only newly-added roots can retain the complete root set.
 *
 * Returns every non-undefined `ProjectState` `loadProjectAtPath` produced (including synthetic,
 * unregistered ones carrying only a parse-error warning — see `loadProjectAtPath`), so callers can
 * publish config warnings even for configs that never register as a project.
 */
export async function scanWorkspaceRootsForProjects(
  ctx: ServerContext,
  workspaceRoots: string[],
  updateWorkspaceRoots = true,
): Promise<ProjectState[]> {
  if (updateWorkspaceRoots) ctx.workspaceRoots = workspaceRoots;
  const results: ProjectState[] = [];
  for (const root of workspaceRoots) {
    const state = await loadProjectAtPath(ctx, join(root, CONFIG_FILE_NAME));
    if (state) results.push(state);
  }
  return results;
}

/**
 * Eagerly load projects for config file paths the client discovered via a deep workspace scan
 * (passed as `initializationOptions.configFiles`). Non-string entries are ignored; entries
 * containing `node_modules` are skipped; the list is capped to avoid pathological workspaces.
 *
 * Returns every non-undefined `ProjectState` produced, same as `scanWorkspaceRootsForProjects`.
 */
export async function loadConfigFilesFromInit(ctx: ServerContext, configFiles: unknown): Promise<ProjectState[]> {
  if (!Array.isArray(configFiles)) return [];
  const MAX_CONFIG_FILES = 20;
  const candidates = configFiles
    .filter((p): p is string => typeof p === "string" && !p.includes("node_modules"))
    .slice(0, MAX_CONFIG_FILES);
  const results: ProjectState[] = [];
  for (const raw of candidates) {
    const state = await loadProjectAtPath(ctx, raw);
    if (state) results.push(state);
  }
  return results;
}

/** Whether `dir` is at or under `root`. */
function isUnder(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(root + sep);
}

/** The innermost workspace root that contains `path`, if any. */
function enclosingWorkspaceRoot(ctx: ServerContext, path: string): string | undefined {
  let best: string | undefined;
  for (const root of ctx.workspaceRoots) {
    const normRoot = pathResolve(root);
    if (isUnder(path, normRoot) && (!best || normRoot.length > best.length)) best = normRoot;
  }
  return best;
}

/**
 * Walk upward from the directory containing `docPath`, looking for `oasis.config.jsonc`, stopping
 * at the enclosing workspace folder root (or the filesystem root if `docPath` isn't under any
 * workspace root). If a config with a non-empty `entries` field is found and isn't already loaded,
 * load it as a new project. This mirrors the CLI's upward config discovery (`findConfigUpward` in
 * `packages/linter/src/config.ts`) so project mode works for any LSP client, not just VSCode's
 * deep `findFiles` scan (see `loadConfigFilesFromInit`).
 *
 * Returns true if a *new* project was loaded as a result of this call.
 */
export async function discoverProjectUpward(ctx: ServerContext, docPath: string): Promise<boolean> {
  const boundary = enclosingWorkspaceRoot(ctx, docPath);
  if (!boundary && ctx.restrictProjectDiscoveryToWorkspaceRoots) return false;
  let dir = dirname(pathResolve(docPath));

  for (;;) {
    if (ctx.upwardMissCache.has(dir)) return false;

    const candidate = join(dir, CONFIG_FILE_NAME);
    if (!ctx.projects.has(candidate)) {
      const result = await readConfigFile(ctx, candidate);
      if (result.ok) {
        const state = await loadProjectAtPath(ctx, candidate);
        if (state) return true;
      }
    }

    if (boundary && dir === boundary) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  ctx.upwardMissCache.add(dirname(pathResolve(docPath)));
  return false;
}

/** Whether `path` is (the name of) an `oasis.config.jsonc` file.
 *
 * Paths come from `URI.fsPath`, which uses backslash separators on Windows, so this can't just
 * check for a trailing `/${CONFIG_FILE_NAME}` (that only matches POSIX-style paths) — it must
 * split on the last `/` *or* `\` to find the basename regardless of which platform produced the
 * path or which platform this check runs on. */
export function isConfigFilePath(path: string): boolean {
  const lastSep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(lastSep + 1) === CONFIG_FILE_NAME;
}

export interface NearestConfigResult {
  configPath: string;
  configFile: LintConfigFile;
  /** Set when this config file exists but fails to parse as JSONC: `configFile` is then `{}` (an
   * empty fallback), not a stale or partial parse. */
  warning?: string;
  /** Structural shape warnings (e.g. `lint.overrides` given as an object, not an array) for a
   * config file that parsed fine as JSONC; empty when the config was fully valid. */
  warnings: string[];
}

/**
 * Find the nearest `oasis.config.jsonc` above `startPath` (read through `ctx.fileSystem`, so
 * unsaved edits to the config are honored), for entries that are *not* part of a loaded project
 * (see `findProjectForEntry` in `workspace.ts` for the project case). Unlike `discoverProjectUpward`,
 * this doesn't require a non-empty `entries` field and doesn't register a project — a config that
 * only sets `lint.rules`/`lint.overrides` with no `entries` still applies to a standalone open
 * document, mirroring `oasis lint`'s own upward config discovery.
 *
 * Mirrors the CLI's `findConfigUpward` (`packages/linter/src/config.ts`): stops at the nearest
 * *existing* config file, whether or not it parses. A config file that exists but fails to parse
 * (e.g. mid-edit) is not skipped in favor of an ancestor's config — that would silently apply the
 * wrong rules/overrides — it's reported back as a warning with an empty fallback config, the same
 * way `oasis lint` would fail loudly rather than fall back further up the tree.
 */
export async function findNearestConfigFile(ctx: ServerContext, startPath: string): Promise<NearestConfigResult | undefined> {
  const boundary = enclosingWorkspaceRoot(ctx, startPath);
  let dir = dirname(pathResolve(startPath));

  for (;;) {
    const candidate = join(dir, CONFIG_FILE_NAME);
    const result = await readConfigFile(ctx, candidate);
    if (result.ok) return { configPath: candidate, configFile: result.configFile, warnings: result.warnings };
    if (result.reason === "parse-error") {
      // Nearest EXISTING config file: stop here rather than walking past it to an ancestor's
      // (possibly unrelated) config.
      return { configPath: candidate, configFile: {}, warning: result.message, warnings: [] };
    }

    if (boundary && dir === boundary) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

/**
 * The single source of truth for "which `lint.rules`/`lint.overrides` config governs `entryPath`":
 * the config of the project it belongs to (already loaded, overlay-aware — see
 * `findProjectForEntry`) if it's a project entry, otherwise the nearest `oasis.config.jsonc` found
 * by walking upward through `ctx.fileSystem` (`findNearestConfigFile`, so unsaved edits to the
 * config file itself are honored either way, without requiring a save or a second, disk-only
 * config read).
 *
 * The standalone (non-project-member) branch is cached per entry path in
 * `ctx.standaloneConfigCache`, since resolving it re-walks directories and re-parses JSONC —
 * `loadProjectAtPath` clears the cache on every config load/reload, so a config file
 * create/change/delete is always picked up on the next resolution. The project branch is not
 * cached here: `findProjectForEntry` is a cheap in-memory lookup already.
 */
export async function resolveConfigForEntry(ctx: ServerContext, entryPath: string): Promise<ResolvedConfig> {
  const project = findProjectForEntry(ctx, entryPath);
  if (project) return { configFile: project.configFile, configPath: project.configPath, warnings: [] };

  const cached = ctx.standaloneConfigCache.get(entryPath);
  if (cached) return cached;

  const nearest = await findNearestConfigFile(ctx, entryPath);
  const resolved: ResolvedConfig = nearest
    ? {
        configFile: nearest.configFile,
        configPath: nearest.configPath,
        warnings: nearest.warning ? [nearest.warning, ...nearest.warnings] : nearest.warnings,
      }
    : { configFile: {}, configPath: undefined, warnings: [] };
  ctx.standaloneConfigCache.set(entryPath, resolved);
  return resolved;
}
