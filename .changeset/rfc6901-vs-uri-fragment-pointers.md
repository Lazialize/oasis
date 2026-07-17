---
"@oasis/core": patch
"@oasis/bundler": patch
"@oasis/server": patch
---

fix(core): separate plain RFC 6901 JSON Pointer parsing from `$ref` URI-fragment decoding, so a
literal percent-escape-looking key (e.g. `%7Bid%7D`) resolves to itself instead of being conflated
with a differently-encoded sibling key. `nodeAtPointer`/`formatPointer` no longer percent-decode or
percent-encode; a new `parseFragmentPointer` performs exactly one URI-decoding pass before the RFC
6901 walk, used only where a pointer comes from a `$ref` fragment (#96).
