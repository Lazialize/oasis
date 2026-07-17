---
"@oasis/core": patch
"@oasis/bundler": patch
---

fix(core,bundler): keep every value below a Specification Extension opaque during reference and
anchor discovery and across root, Paths, Callback, and `$ref` sibling bundling paths (#91).
