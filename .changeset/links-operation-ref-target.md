---
"@oasis/linter": patch
---

fix(linter): require Link Object `operationRef` targets to resolve to an Operation Object.
`structure/links` previously only checked that `operationRef` pointers into `/paths/...` or
`/webhooks/...` resolved to *some* node, and skipped local pointers into other sections (e.g.
`#/components/schemas/Pet`) entirely. It now resolves every local `operationRef` and requires the
target to actually be an Operation Object (an HTTP-method child of a Path Item under `paths`, or on
3.1, `webhooks`); a Schema Object, Path Item Object, missing pointer, or other node kind is reported.
External URI targets (`https:`, `urn:`, scheme-relative URLs) cannot be verified locally and remain
unchecked, as the spec allows referencing operations in external documents (#107).
