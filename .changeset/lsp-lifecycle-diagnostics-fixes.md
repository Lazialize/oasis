---
"@oasis/server": patch
---

fix: LSP server lifecycle and diagnostics-flow bug fixes (with matching VS Code extension updates, released via the synced extension version)

- diagnostics for a file shared by multiple project entries are now stored per entry and published as the merged, deduplicated union, so one entry's results no longer clobber another's and unloading an entry removes only its own contribution (#48)
- stale asynchronous validations are discarded: a lint run superseded by a newer edit, a project reload, or a document close can no longer finish late and overwrite newer diagnostics or poison the workspace-graph cache (#49)
- closing a document now revalidates project state from disk: an unsaved project-member buffer's diagnostics are recomputed from the file on disk, and closing an edited `oasis.config.jsonc` reloads the on-disk project configuration (#50)
- external (on-disk) changes to closed project files — git checkout, codegen, another process — now refresh diagnostics: the VS Code extension watches workspace YAML/JSON files and the server invalidates and revalidates affected entry graphs, re-expanding glob entries on create/delete, while never replacing an open unsaved buffer with disk content (#51)
- the lightweight "looks like OpenAPI" guard (server and VS Code extension) now only matches an `openapi` key at the document root, so files with a nested `openapi` property are no longer wrongly synchronized and linted (#52)
- the VS Code extension resynchronizes already-open documents whenever project mode toggles: fragment files gain a synthetic `didOpen` when a config appears, and non-OpenAPI documents are closed on the server when the last config disappears (#58)
