---
"@oasis/linter": patch
---

Three `examples/schema-match` fixes:

- Count Unicode code points for `minLength`/`maxLength` (#61): string length is now measured in
  code points per JSON Schema, not UTF-16 code units, so a supplementary-plane emoji counts as 1
  and `maxLength: 1` accepts it. Diagnostics report the same code-point count.
- Honor `patternProperties` when validating examples (#43, 3.1): each example property is matched
  against every `patternProperties` regex and validated against all matching schemas;
  `additionalProperties` applies only when neither `properties` nor `patternProperties` matches.
  Invalid pattern regexes are skipped without crashing. (`unevaluatedProperties` remains
  deliberately unevaluated — see the rule doc.)
- Keep validation diagnostics attached to the owning document (#42): a failure that points at a
  violated schema keyword now carries the schema's own file, so validating an example against a
  schema in another file no longer produces a diagnostic range converted against the wrong
  document.
