---
"@oasis/core": patch
"@oasis/bundler": patch
---

fix(bundler): canonicalize resolved target identities before component deduplication. A resolved
`$ref` now carries a canonical RFC 6901 pointer within its resource (`ResolvedRef.canonicalPointer`):
URI percent-encoding is decoded at the fragment layer and an anchor is mapped to the pointer of the
node it names. The bundler keys component deduplication and `--dereference` cycle detection on this
canonical identity (resource + canonical pointer) instead of the raw input fragment spelling, so
URI-equivalent references — percent-encoding variants like `#/components/schemas/Foo` vs
`#/components/schemas/%46oo`, or an anchor vs a JSON Pointer to the same node — lift a single shared
component rather than duplicating it (e.g. `Foo` and `Foo_2`). Distinct embedded `$id` resources
stay separate (#95).
