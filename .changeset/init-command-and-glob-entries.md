---
"@oasis/cli": minor
"@oasis/linter": minor
---

New `oasis init` command scaffolds an `oasis.config.jsonc` in the current directory: it scans up
to 2 levels deep (skipping `node_modules` and hidden directories) for YAML/JSON files whose root
has an `openapi:` key and pre-fills `entries` with what it finds, refusing to overwrite an
existing config (exit `2`).

Config `entries` may now be glob patterns (`"entries": ["apis/**/openapi.yaml"]`), expanded
relative to the config file's directory. Symlinked directories are not followed, hidden
directories and `node_modules` never match, and files matched by more than one entry are deduped.
A glob matching no files gets the same warning-diagnostic treatment as a missing literal entry.
Applies to both `oasis lint` (no-arg mode) and LSP project mode, which re-expands globs on config
reload.
