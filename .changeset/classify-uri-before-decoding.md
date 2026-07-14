---
"@oasis/core": patch
"@oasis/server": patch
---

fix(core): classify raw URI references before decoding filesystem paths, and resolve `file:` URLs
with URL path semantics so encoded delimiters remain valid relative filenames (#93).
