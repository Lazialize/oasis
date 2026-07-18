---
"@oasis/core": patch
---

fix(core): recognize RFC 3986-compliant one-character URI schemes. The `uriScheme`
function now correctly accepts valid single-letter schemes like `x:thing`, instead of
blanket-rejecting them to avoid Windows drive paths. Windows paths (`C:\path`, `C:/path`)
are now explicitly detected by checking for the drive-path pattern (single letter
followed by `:` and a path separator) rather than rejecting all one-character schemes,
which was too broad and broke custom URI schemes and hierarchical URIs like `z://`.
