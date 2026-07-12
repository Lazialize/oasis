import { dirname, join, resolve as pathResolve, sep } from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { CONFIG_FILE_NAME, expandGlobEntry, isGlobPattern } from "@oasis/linter";
import type { LintConfigFile } from "@oasis/linter";
import type { ProjectState, ServerContext } from "./workspace.ts";

// Reads through `ctx.fileSystem` (the overlay FS) rather than node:fs directly, so this works
// uniformly against real disk and against InMemoryFileSystem in tests, and so unsaved edits to
// the config file itself are picked up without a save.

/** Result of reading+parsing a config file, distinguishing "doesn't exist" from "exists but is invalid JSONC" so callers can react differently (see `loadProjectAtPath`). */
export type ConfigReadResult =
  | { ok: true; configFile: LintConfigFile }
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
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false }) as
    | LintConfigFile
    | undefined;
  if (errors.length > 0) {
    return {
      ok: false,
      reason: "parse-error",
      message: `Failed to parse ${CONFIG_FILE_NAME}: invalid JSONC (error code ${errors[0]?.error})`,
    };
  }
  return { ok: true, configFile: parsed ?? {} };
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
 *   again. If there was no previously-loaded project, this is a no-op that returns undefined.
 *
 * Returns the resulting `ProjectState`, or undefined if no project is loaded at this path.
 *
 * Safe to call for a path that was never a project (e.g. probing during upward discovery, or a
 * root-of-workspace scan where no config exists there): it's then a no-op.
 */
export async function loadProjectAtPath(ctx: ServerContext, rawConfigPath: string): Promise<ProjectState | undefined> {
  const configPath = pathResolve(rawConfigPath);
  const result = await readConfigFile(ctx, configPath);

  if (!result.ok) {
    if (result.reason === "missing") {
      unloadProject(ctx, configPath);
      return undefined;
    }
    // Parse error: keep the last-good project untouched, but surface the parse error as a
    // one-off warning on the returned (not stored) state.
    const existing = ctx.projects.get(configPath);
    if (!existing) return undefined;
    return { ...existing, warnings: [result.message] };
  }

  const { entries, warnings } = await resolveProjectEntries(ctx, configPath, result.configFile);
  if (entries.length === 0) {
    unloadProject(ctx, configPath);
    return undefined;
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
  ctx.graphCache.clear();
  ctx.upwardMissCache.clear();
  return state;
}

/**
 * Search each workspace folder root (no deep scan) for `oasis.config.jsonc` and load it as a
 * project if it declares a non-empty `entries` list. This is one of two eager-discovery
 * mechanisms (the other being `initializationOptions.configFiles`, see `loadConfigFilesFromInit`);
 * both dedupe naturally since projects are keyed by resolved config path. Also records
 * `workspaceRoots` on the context so upward discovery (`discoverProjectUpward`) knows where to
 * stop walking.
 */
export async function scanWorkspaceRootsForProjects(ctx: ServerContext, workspaceRoots: string[]): Promise<void> {
  ctx.workspaceRoots = workspaceRoots;
  for (const root of workspaceRoots) {
    await loadProjectAtPath(ctx, join(root, CONFIG_FILE_NAME));
  }
}

/**
 * Eagerly load projects for config file paths the client discovered via a deep workspace scan
 * (passed as `initializationOptions.configFiles`). Non-string entries are ignored; entries
 * containing `node_modules` are skipped; the list is capped to avoid pathological workspaces.
 */
export async function loadConfigFilesFromInit(ctx: ServerContext, configFiles: unknown): Promise<void> {
  if (!Array.isArray(configFiles)) return;
  const MAX_CONFIG_FILES = 20;
  const candidates = configFiles
    .filter((p): p is string => typeof p === "string" && !p.includes("node_modules"))
    .slice(0, MAX_CONFIG_FILES);
  for (const raw of candidates) {
    await loadProjectAtPath(ctx, raw);
  }
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

/** Whether `path` is (the name of) an `oasis.config.jsonc` file. */
export function isConfigFilePath(path: string): boolean {
  return path.endsWith(`/${CONFIG_FILE_NAME}`) || path === CONFIG_FILE_NAME;
}

/**
 * Find the nearest `oasis.config.jsonc` above `startPath` (read through `ctx.fileSystem`, so
 * unsaved edits to the config are honored), for entries that are *not* part of a loaded project
 * (see `findProjectForEntry` in `workspace.ts` for the project case). Unlike `discoverProjectUpward`,
 * this doesn't require a non-empty `entries` field and doesn't register a project — a config that
 * only sets `lint.rules`/`lint.overrides` with no `entries` still applies to a standalone open
 * document, mirroring `oasis lint`'s own upward config discovery. A config that exists but fails to
 * parse is treated like "no config found" here (there's no project state to fall back to for a
 * standalone entry).
 */
export async function findNearestConfigFile(
  ctx: ServerContext,
  startPath: string,
): Promise<{ configPath: string; configFile: LintConfigFile } | undefined> {
  const boundary = enclosingWorkspaceRoot(ctx, startPath);
  let dir = dirname(pathResolve(startPath));

  for (;;) {
    const candidate = join(dir, CONFIG_FILE_NAME);
    const result = await readConfigFile(ctx, candidate);
    if (result.ok) return { configPath: candidate, configFile: result.configFile };

    if (boundary && dir === boundary) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}
