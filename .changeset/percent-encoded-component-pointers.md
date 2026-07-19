---
"@oasis/core": patch
"@oasis/server": patch
---

fix(server): recognize percent-encoded component pointer segments in references and rename.
`$ref`s like `#/components/schemas/%46oo` (RFC 6901 §6 URI-fragment percent-encoding for `Foo`)
resolved correctly for definition navigation, but find-references and rename discarded them:
`collectComponentReferences` compared a resolved ref's raw, still-encoded pointer spelling against
the target's canonical (decoded) pointer, so an encoded segment could never match. It now compares
against `resolved.canonicalPointer`, and `componentNameSegmentRange` locates the name's source range
by decoding each raw fragment segment (percent-encoding and JSON Pointer `~0`/`~1`) instead of
searching for the decoded literal in the source text, so the returned range always spans the exact
encoded source span — preserving any nested pointer suffix and leaving plain, unencoded references
unaffected.
