import { dirname, join } from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { CONFIG_FILE_NAME } from "@oasis/linter";
import type { LintConfigFile } from "@oasis/linter";
import type { ServerContext } from "./workspace.ts";

// Reads through `ctx.fileSystem` (the overlay FS) rather than node:fs directly, so this works
// uniformly against real disk and against InMemoryFileSystem in tests, and so unsaved edits to
// the config file itself are picked up without a save.

async function readConfigFile(ctx: ServerContext, path: string): Promise<LintConfigFile | undefined> {
  let text: string;
  try {
    text = await ctx.fileSystem.readFile(path);
  } catch {
    return undefined;
  }
  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false }) as
    | LintConfigFile
    | undefined;
  if (errors.length > 0) return undefined;
  return parsed ?? {};
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
  const warnings: string[] = [];
  for (const raw of configFile.entries ?? []) {
    const abs = ctx.fileSystem.resolve(configPath, raw);
    try {
      await ctx.fileSystem.readFile(abs);
      entries.push(abs);
    } catch {
      // Unknown/missing entry: skip it rather than crashing project-mode startup, but still
      // surface it so it doesn't fail silently (see ProjectState.warnings).
      warnings.push(`Entry "${raw}" in ${CONFIG_FILE_NAME} not found (resolved to "${abs}"); skipping.`);
    }
  }
  return { entries, warnings };
}

/**
 * Search each workspace folder root (no deep scan) for `oasis.config.jsonc`. The first folder
 * whose config declares a non-empty `entries` list wins and becomes the project; sets
 * `ctx.project` to that state, or clears it (undefined) if no folder has one.
 */
export async function loadProjectConfig(ctx: ServerContext, workspaceRoots: string[]): Promise<void> {
  for (const root of workspaceRoots) {
    const candidate = join(root, CONFIG_FILE_NAME);
    const configFile = await readConfigFile(ctx, candidate);
    if (!configFile) continue;

    const { entries, warnings } = await resolveProjectEntries(ctx, candidate, configFile);
    if (entries.length === 0) continue;

    ctx.project = { configPath: candidate, configDir: dirname(candidate), entryPaths: entries, warnings };
    // Drop cached graphs so a reload (e.g. the config file itself changed) picks up new entries.
    ctx.graphCache.clear();
    return;
  }
  ctx.project = undefined;
}

/** Whether `path` is (the name of) an `oasis.config.jsonc` file. */
export function isConfigFilePath(path: string): boolean {
  return path.endsWith(`/${CONFIG_FILE_NAME}`) || path === CONFIG_FILE_NAME;
}
