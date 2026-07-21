---
"@oasis/bundler": patch
---

fix(bundler): materialize YAML merge keys ("<<") when bundling, instead of serializing a literal
`<<` property. Bundling a document that uses `<<: *anchor` (or `<<: [*a, *b]`) now emits the
effective merged mapping in both YAML and JSON output, using the same precedence semantics as
core's merge-aware `childAt` traversal: an explicit key always overrides a merged one regardless of
relative order, a sequence merge resolves left-to-right (earliest source wins a shared key), nested
merge sources are fully materialized, and `$ref`s reached only through a merged value are lifted and
rewritten like any other reference. Alias cycles through a merge key remain safely bounded.
