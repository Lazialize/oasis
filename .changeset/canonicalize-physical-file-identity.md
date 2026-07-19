---
"@oasis/core": patch
"@oasis/server": patch
"@oasis/cli": patch
---

fix(core): canonicalize physical file identity across symlinks and case aliases. `NodeFileSystem.canonicalize` previously only ran `path.resolve`, so a symlinked directory alias or a differently-cased path on a case-insensitive filesystem (default macOS/Windows) could enter the workspace graph as a second, duplicate document instead of being recognised as the same physical file. `canonicalize` now recovers the real, on-disk-cased path (memoized per instance to avoid extra syscalls on hot lookups), falling back to a deterministic lexical path for references that don't exist on disk yet, and to an ancestor's resolved identity when only part of the path exists. `$ref` target lookups (`loadWorkspaceGraph` and `resolveRef`) canonicalize `file:` resource URIs the same way, so cycle detection and reference resolution also see one identity per physical file across aliased spellings. The LSP server canonicalizes open-document URIs, workspace roots, and config entries the same way (while still replying on the exact URI the client opened), and the CLI bundle command looks its entry up by the graph's canonical entry path.
