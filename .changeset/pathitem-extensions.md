---
"@oasis/linter": patch
---

fix(linter): allow specification extensions (`x-*` keys) on Path Item Objects. The `structure/http-methods` and `structure/callbacks` rules now correctly permit specification extensions on Path Items, matching the shared object-shape table's `extensions: true` declaration. Unknown non-extension keys remain flagged (#101).
