---
"@oasis/cli": patch
---

fix(cli): percent-encode repository-relative SARIF artifact URIs per RFC 3986 — spaces, `#`, `%`,
and non-ASCII characters in filenames are now encoded (path separators preserved), so a valid
filename like `spec#draft.yaml` is no longer parsed as a URI fragment (#78).
