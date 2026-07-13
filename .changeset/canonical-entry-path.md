---
"@oasis/core": patch
---

Canonicalize the workspace-graph entry path before traversal. A relative entry document is no
longer loaded a second time under its absolute path when another file `$ref`s back to it, so the
entry is parsed once and cross-file cycle detection no longer misfires against a duplicate
identity. `WorkspaceGraph.entryPath` now always holds the canonical path, and `FileSystem` gains a
`canonicalize(path)` method.
