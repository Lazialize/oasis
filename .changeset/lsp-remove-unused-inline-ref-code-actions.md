---
"@oasis/server": minor
---

`oasis lsp` gains two code actions: "Remove unused component" now deletes the whole component
entry as before, and additionally collapses its section key (and `components:` itself) when the
removal empties them; a new "Inline reference" refactor replaces a `$ref` with its resolved
target's content, re-indented in place, working across files. It's not offered when the target
doesn't resolve, would loop back into one of the ref's own ancestors, is a 3.1 `$ref` with
meaningful sibling keys, is a whole Path Item `$ref` under `paths`/`webhooks`, or (for cross-file
refs) the target's subtree contains a relative ref to a third file that would break once copied.
