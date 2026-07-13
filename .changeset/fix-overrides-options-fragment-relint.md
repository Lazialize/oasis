---
"@oasis/linter": patch
"@oasis/server": patch
---

Fix two bugs:

- `lint.overrides` now applies the overridden rule *options*, not just severity. Previously
  `RuleContext.options` was resolved once from the top-level `lint.rules` entry before a rule ran,
  so a matching override could change a diagnostic's severity but never the options a rule actually
  checked against. `RuleContext` gained `optionsFor(filePath)` to resolve options per matched file
  (the same override resolution `report()` already used for severity); `style/naming-convention`
  (the only rule that takes options today) now uses it, so e.g. an `operationId` casing override for
  a glob of files is honored instead of silently falling back to the top-level casing style.
- The LSP server now re-validates open standalone entries when an open `$ref`'d fragment file with
  no top-level `openapi:` key is edited. Previously such a fragment routed as `{kind: "ignored"}` on
  edit; its graph cache was invalidated correctly, but nothing re-validated the dependent standalone
  entry, so its published diagnostics went stale until the entry document itself was next edited.
