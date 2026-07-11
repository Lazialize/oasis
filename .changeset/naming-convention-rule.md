---
"@oasis/linter": minor
---

Add the `naming-convention` lint rule: configurable casing checks for operationIds, component
names (`components/*`, including 3.1 `pathItems`), parameter names (skipping `in: header`), and
schema property names. Off by default and a no-op until configured with an options object, e.g.
`"naming-convention": ["warn", { "operationId": "camelCase", "componentName": "PascalCase" }]`.
This is the first built-in rule to consume the rule-options plumbing added previously.
