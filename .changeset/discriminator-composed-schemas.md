---
"@oasis/linter": patch
---

fix(linter): validate `structure/discriminator` `propertyName` through composed and inherited
schemas. The rule previously inspected only a branch's direct `properties`/`required` and required a
composition keyword on the same Schema as the `discriminator`, producing false positives for valid
patterns. It now derives each `oneOf`/`anyOf` branch's *effective* `properties`/`required` by
flattening `allOf` members and following `$ref`s (local, nested, and cross-file, with cycle
guarding), and accepts the OpenAPI parent-discriminator pattern — a `discriminator` without
`oneOf`/`anyOf` whose Schema itself defines `propertyName` (children reference it via their own
`allOf`). Negative controls still fire when the effective Schema genuinely lacks the property or,
in OpenAPI 3.0, its `required` entry. Source ranges on diagnostics are unchanged (#106).
