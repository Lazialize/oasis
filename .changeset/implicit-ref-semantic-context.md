---
"@oasis/server": patch
---

fix(server): restrict implicit security-scheme and discriminator reference discovery to semantic
OpenAPI contexts. Bare Security Requirement keys are now only collected on the root and Operation
Objects, and discriminator `mapping` names only on actual Schema Objects; lookalike `security` and
`discriminator.mapping` structures inside literal-data contexts (`example`, `examples`, `default`,
`enum`, `const`, and `x-*` vendor extensions) are skipped, so find-references and rename no longer
rewrite documented example payloads (#118).
