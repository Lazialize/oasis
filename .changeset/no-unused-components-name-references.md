---
"@oasis/linter": minor
---

`no-unused-components` now counts name-based references, not just `$ref`: a security scheme
named in any `security` requirement (root, operation, or 3.1 webhook operation) is treated as
used, and a `discriminator.mapping` value (either the `#/components/schemas/X` pointer form or
the bare-name shorthand) marks the target schema as used. This removes false positives for
components that were only ever referenced by name.
