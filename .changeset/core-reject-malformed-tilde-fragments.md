---
"@oasis/core": patch
---

fix(core): reject `$ref` JSON Pointer fragments with a malformed tilde escape (e.g. `~2`, or the
percent-encoded `%7E2`) instead of resolving them as literal text. Per RFC 6901, `~` may only occur
as `~0` or `~1` inside a pointer token; a fragment containing any other `~` sequence now fails
resolution with a source-ranged "unresolved reference" diagnostic instead of silently targeting a
real (but unintended) document node. Valid `~0`/`~1` escapes and plain-name anchor fragments are
unaffected (#211).
