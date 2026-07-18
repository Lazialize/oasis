---
"@oasis/server": patch
---

fix(server): preserve document URI identity for `untitled:` and `vscode-remote:` documents. The
language server no longer collapses non-`file:` document URIs into a lossy filesystem path — it now
maps each such URI to a stable synthetic graph path and back, so the open buffer is read from the
overlay (instead of ENOENT-ing on disk) and every diagnostic/response is reported on the original
document URI.
