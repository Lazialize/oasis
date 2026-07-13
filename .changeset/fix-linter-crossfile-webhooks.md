---
"@oasis/linter": patch
---

Fix several linter rules that missed violations reachable only through a $ref'd path item or a 3.1 `webhooks` map: `structure/http-methods` and `structure/field-types` now resolve path-item `$ref`s and walk `webhooks` (previously they only inspected the entry document's literal `paths`), and `tags/no-unused` no longer reports a tag used only by a webhook operation as unused. Also: `paths/no-duplicates` now normalizes partial-segment path templates (e.g. `/files/report-{id}.json` vs `/files/report-{docId}.json`) instead of only whole-segment ones, and glob matching in `lint.overrides` now normalizes Windows-style path separators before matching against config patterns.
