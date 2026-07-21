---
"@oasis/linter": patch
---

Fix `components/no-unused` falsely reporting a `$ref` "component" when a component section is imported from another file as a Reference Object (e.g. `schemas: { $ref: './schemas.yaml' }`). The `$ref`/`$dynamicRef` key is a reference marker, not a component name, so it is no longer flagged — a common multi-file layout no longer surfaces a spurious `Component "$ref" in "components/schemas" is not used` warning.
