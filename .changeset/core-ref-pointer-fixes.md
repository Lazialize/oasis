---
"@oasis/core": patch
---

fix: core correctness fixes ahead of 1.0

- `findRefs` no longer treats `$ref`-shaped literal data inside `example`/`default`/`enum`/`const` as a real reference when the enclosing property is named like a container keyword (`parameters`, `headers`, `schemas`, ...)
- `formatPointer` now percent-encodes a literal `%` followed by hex digits so `formatPointer`/`parsePointer` are exact inverses (component names containing `%XX` resolve correctly)
- a file that fails to load is attempted and diagnosed once, instead of once per referencing `$ref`
- a leading BOM is stripped at parse time so first-line columns match what editors display
