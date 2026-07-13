---
"@oasis/bundler": patch
"@oasis/cli": patch
---

fix: bundler and bundle CLI bug fixes

- Whole-document `$ref`s under 3.1 `components/pathItems` are now lifted into `components/pathItems` (not `components/schemas`), matching how a fragment ref to a path item already behaved (#27)
- Specification Extension (`x-*`) payloads are treated as opaque data when bundling: structural-looking keys inside them (`$ref`, `mapping`, `schema`, `properties`, `examples`, ...) are copied through verbatim instead of being rewritten as references (#28)
- `--dereference` reference-cycle slots now go through the same reserved-name/`uniqueName` allocation as normal lifted components, so a cycle slot can no longer overwrite an existing component whose name collides with the pointer tail; each cycle site emits a single deduplicated warning (#29)
- `oasis bundle` no longer aborts when only an external `$ref` target is missing: it now matches the bundler API, emitting the bundle with the unresolved reference left verbatim plus a warning (exit 0). Genuine syntax errors and entry-load failures still abort with exit 2 (#30)
- In `--dereference` mode, retention of unreferenced entry-document components is now independent of source declaration order: preservation is decided up front, so semantically equivalent component maps always retain the same members (#63)
