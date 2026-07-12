---
"@oasis/linter": minor
---

Lint config: rules can now take an options object (`"rule-name": ["error", { ...options }]`
alongside the existing plain-severity form), and `lint.overrides` applies rule config to files
matching a glob (matched relative to the config file's directory, including files reached only via
`$ref`). Both are plumbed through the shared engine, so `oasis lint` and the LSP server pick them
up the same way. No built-in rule consumes options yet.
