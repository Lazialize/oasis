---
"@oasis/linter": patch
---

feat(linter): add `tags/no-duplicates` rule to enforce unique tag names in the root `tags` list. The linter now reports duplicate tag declarations with exact source range information pointing to the later occurrences (#110).
