---
"@oasis/linter": patch
"@oasis/server": patch
---

fix(linter): attach `paths/params-defined` missing-parameter diagnostics to the path template's
owning key instead of the resolved Path Item file. When a path template like `/pets/{id}` `$ref`s an
external Path Item, the "no matching `in: path` parameter" diagnostic previously reported against the
resolved Path Item's file/range — a location that contains neither the template nor `{id}` — which
also caused `# oasis-disable-*` suppressions and `lint.overrides` to be evaluated against the wrong
file. The diagnostic now attaches to the `/pets/{id}` key in the entry document that declares it,
pointing at the `{id}` placeholder's own span where possible. The `server` package's "Add parameter
definition" quick fix is updated to match diagnostics at the template key while still editing the
path item's actual (possibly different-file) body (#109).
