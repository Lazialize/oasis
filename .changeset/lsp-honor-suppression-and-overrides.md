---
"@oasis/server": patch
---

Fix `oasis lsp` diagnostics to actually resolve `lint.rules`/`lint.overrides` from the project's
`oasis.config.jsonc` (previously it silently re-read config from disk via the CLI's loader, so
overrides and severity changes in an unsaved config buffer — and, in tests, any config that wasn't
also present on real disk — never took effect). Diagnostics for project entries now use the
already-loaded, overlay-aware project config directly; standalone (non-project) open documents
still discover the nearest `oasis.config.jsonc` upward, also through the overlay. Editing a config
file to invalid JSONC now keeps the last-good project loaded (with a parse-error diagnostic on the
config file) instead of unloading it.
