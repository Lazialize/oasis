---
"@oasis/cli": patch
---

Fix three CLI bugs: `oasis init` now accepts `-h`/`--help` flags and prints usage; `oasis lint --format` and `oasis bundle --format` now properly report "requires a value" when no value is provided instead of misleading format validation errors.
