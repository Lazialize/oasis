import { looksLikeOpenApi } from "./openapi-guard.ts";
import { isConfigFilePath } from "./project.ts";
import { findOwningEntry } from "./workspace.ts";
import type { ServerContext } from "./workspace.ts";

export type DocumentRoute =
  /** The document is the project's `oasis.config.jsonc`: reload project config, don't lint it. */
  | { kind: "config" }
  /** The document belongs to a project entry's graph: (re)lint the owning entry. */
  | { kind: "project-member"; entryPath: string }
  /** Not a project member, but looks like its own OpenAPI document: today's standalone behavior. */
  | { kind: "standalone"; entryPath: string }
  /** Not a project member and doesn't look like OpenAPI: no diagnostics, left alone. */
  | { kind: "ignored" };

/**
 * Decide how a document at `path` (with current content `text`) should be handled. Mirrors the
 * three document categories described in the project-mode design: project member, standalone
 * OpenAPI entry, or neither.
 */
export async function routeDocument(ctx: ServerContext, path: string, text: string): Promise<DocumentRoute> {
  if (isConfigFilePath(path)) return { kind: "config" };

  const owner = await findOwningEntry(ctx, path);
  if (owner) return { kind: "project-member", entryPath: owner };

  if (!looksLikeOpenApi(text)) return { kind: "ignored" };

  return { kind: "standalone", entryPath: path };
}
