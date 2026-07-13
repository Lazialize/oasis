import { looksLikeOpenApi } from "./openapi-guard.ts";
import { discoverProjectUpward, isConfigFilePath } from "./project.ts";
import { findEntriesLastContaining, findOwningEntry } from "./workspace.ts";
import type { ServerContext } from "./workspace.ts";

export type DocumentRoute =
  /** The document is the project's `oasis.config.jsonc`: reload project config, don't lint it. */
  | { kind: "config" }
  /** The document belongs to a project entry's graph: (re)lint the owning entry. */
  | { kind: "project-member"; entryPath: string }
  /** Not a project member, but looks like its own OpenAPI document: today's standalone behavior. */
  | { kind: "standalone"; entryPath: string }
  /**
   * Not a project member and doesn't look like OpenAPI: no diagnostics of its own. When it's
   * nonetheless a `$ref`'d fragment of one or more currently-open standalone entries (per
   * `findEntriesLastContaining`), those entries are listed so the caller can re-validate them —
   * otherwise their published diagnostics would go stale until the entry document itself is next
   * edited (the entry's graph cache was already invalidated for this same file change).
   */
  | { kind: "ignored"; dependentStandaloneEntries?: string[] };

/**
 * Decide how a document at `path` (with current content `text`) should be handled. Mirrors the
 * three document categories described in the project-mode design: project member, standalone
 * OpenAPI entry, or neither.
 *
 * If `path` isn't a member of any already-loaded project, this walks upward from its directory
 * looking for an `oasis.config.jsonc` that hasn't been loaded yet (see `discoverProjectUpward`) —
 * this is what makes project mode work when a client (or a client with no deep-scan support)
 * opens a subdirectory config's fragment file without the config itself ever having been synced or
 * pre-declared via `initializationOptions.configFiles`.
 */
export async function routeDocument(ctx: ServerContext, path: string, text: string): Promise<DocumentRoute> {
  if (isConfigFilePath(path)) return { kind: "config" };

  let owner = await findOwningEntry(ctx, path);
  if (!owner && (await discoverProjectUpward(ctx, path))) {
    owner = await findOwningEntry(ctx, path);
  }
  if (owner) {
    // No longer standalone (if it ever was): drop it from the set `connection.ts` re-validates on
    // config file changes (see `ServerContext.openStandaloneEntries`).
    ctx.openStandaloneEntries.delete(path);
    return { kind: "project-member", entryPath: owner };
  }

  if (!looksLikeOpenApi(text)) {
    ctx.openStandaloneEntries.delete(path);
    const dependentStandaloneEntries = findEntriesLastContaining(ctx, path, ctx.openStandaloneEntries);
    return dependentStandaloneEntries.length > 0 ? { kind: "ignored", dependentStandaloneEntries } : { kind: "ignored" };
  }

  ctx.openStandaloneEntries.add(path);
  return { kind: "standalone", entryPath: path };
}
