---
"@oasis/server": patch
---

Fixes to the v0.7 LSP work: config resolution now goes through a single, cached
`resolveConfigForEntry` so project-member and standalone documents (and connection.ts's config
warnings) always agree on which `oasis.config.jsonc` governs a file; editing an override-only
config (no `entries`) now re-lints already-open standalone documents instead of only taking effect
on an unrelated edit; a config file that exists but fails to parse no longer gets silently skipped
in favor of an ancestor's config; a config whose first-ever load is invalid JSONC now surfaces a
warning instead of being dropped silently. Workspace symbols no longer omit a project whose graph
was evicted by closing an unrelated document, now resolve operations behind `$ref`'d path items
(not just `$ref`'d fragments), and are memoized per document/graph. Symbol ranges (workspace and
document symbols) no longer overshoot into trailing whitespace/comments. Document Links now
compute the file-part range from the raw source, fixing incorrect ranges for double-quoted `$ref`
values containing escape sequences.
