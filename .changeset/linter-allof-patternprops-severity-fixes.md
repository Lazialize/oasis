---
"@oasis/linter": patch
---

fix: linter false-positive and severity-override fixes

- `examples/schema-match` no longer flags a property as "unexpected" under an `allOf` branch's `additionalProperties: false` when that property is legitimately contributed by a sibling `allOf` branch (e.g. an inherited base schema via `$ref`) — the common inheritance idiom
- `structure/schema-keywords` no longer reports a `required` entry as unsatisfiable under `additionalProperties: false` when it's actually admitted by a (3.1) `patternProperties` regex
- a `lint.overrides` entry setting a rule to `"off"` for matching files now silences all of that rule's reports for those files, including ones that pass an explicit severity via `ctx.report(..., { severity })`
- `structure/field-types` response status code validation is now case-sensitive per spec: `"2xx"`/`"DEFAULT"` are flagged; only `"2XX"`-style uppercase ranges and lowercase `"default"` are accepted
