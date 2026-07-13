---
"@oasis/cli": patch
---

fix: encode absolute SARIF artifact URIs with `pathToFileURL` (#32)

`--format sarif`'s fallback absolute `file://` artifact location (used when a diagnostic's file is
outside `cwd`) is now built with `node:url`'s `pathToFileURL` instead of string concatenation, so
spaces, `#`, `%`, non-ASCII characters, and platform path syntax are correctly percent-encoded.
Repo-relative, forward-slash URIs for files under `cwd` are unchanged.
