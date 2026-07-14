---
"@oasis/cli": patch
---

fix(cli): reject empty values in the `--flag=` syntax (e.g. `--config=`, `--out=`, `-o=`,
`--format=`) so they fail with a usage error like the separated form, instead of being silently
treated as no-config / stdout (#79).
