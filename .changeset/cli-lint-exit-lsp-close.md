---
"@oasis/linter": patch
"@oasis/cli": patch
"@oasis/server": patch
---

fix: CLI and LSP behavior fixes ahead of 1.0

- `oasis lint` on an entry file that cannot be loaded now reports an error and exits 1, instead of silently reporting zero diagnostics and exiting 0
- `oasis lint` now rejects unknown single-dash flags (e.g. `-format`) like `oasis bundle` already did, and both commands accept a `--` separator for entry paths that start with `-`
- the LSP server clears published diagnostics when a standalone (non-project) document is closed, instead of leaving them in the Problems panel indefinitely
