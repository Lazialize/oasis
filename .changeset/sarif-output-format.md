---
"@oasis/cli": minor
---

`oasis lint --format sarif` emits a SARIF 2.1.0 log on stdout, suitable for upload to GitHub Code
Scanning via `github/codeql-action/upload-sarif`. Rule severities map to SARIF levels
(error/warning/info → error/warning/note), locations use repo-relative (cwd-relative) URIs when
possible and fall back to absolute `file://` URIs for diagnostics outside the working directory,
and the `rules` array is deduped to only the rules that actually produced results. README documents
the recipe under the `oasis lint` command docs.
