---
"@oasis/linter": patch
"@oasis/server": patch
---

Fix two multi-entry-workspace bugs when an `oasis.config.jsonc` declares several `entries` whose graphs share a `$ref`'d file:

- Rename and find-references now union every loaded graph that contains the target file instead of stopping at the first owning entry. Renaming a component defined in a shared file used to leave sibling entries with a dangling `$ref`, and find-references undercounted; both now cover all reaching graphs and dedupe a file (and its refs) shared by two graphs.
- `components/no-unused` no longer reports a shared component as unused when only a sibling entry references it. The lint engine's `RuleContext` gained an optional `externalDocuments` field (populated only by the server's project-mode lint path with sibling entries' graph documents) so cross-entry usage counts; a CLI lint of a single entry graph is unchanged. The server's "Remove unused component" quickfix also cross-checks all loaded graphs and won't offer a destructive delete for a component a sibling entry still references.
