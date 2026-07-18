---
"@oasis/core": patch
---

fix(core): reject malformed RFC 6901 JSON Pointers in plain-pointer API. `parsePointer` now returns
`undefined` for pointers that violate RFC 6901: non-empty pointers without a leading slash, and
pointers with invalid tilde escapes (anything other than `~0` and `~1`). `nodeAtPointer` returns
`undefined` when given an invalid pointer, instead of silently resolving it as a different valid
pointer. URI-fragment tolerance remains a separate policy in `parseFragmentPointer` and does not
weaken the plain RFC 6901 validation (#152).
