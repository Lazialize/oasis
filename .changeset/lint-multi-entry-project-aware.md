---
"@oasis/cli": patch
"@oasis/linter": patch
"@oasis/server": patch
---

fix(cli): make multi-entry `oasis lint` project-aware — sibling entry graphs now contribute
`externalDocuments` so shared components used only by another entry aren't flagged unused, and
exact-duplicate diagnostics from a shared file are merged instead of doubled (#76).
