---
"@oasis/server": patch
---

fix(server): stop treating ref-like strings in literal data (Schema Object `example`, `examples`,
`default`, `enum`, `const`, and `x-*` Specification Extension payloads) as `$ref`s for definition,
hover, and rename. `findRefAtPosition` previously classified any scalar containing `#/` or starting
with `./`/`../` as a reference by text shape alone, so a value like `example: '#/components/schemas/Foo'`
could be navigated to, hovered over, and used to initiate a rename that edited the `Foo` component's
definition while leaving the example string itself untouched. It now recognizes reference occurrences
semantically, via the same `findRefs` walk that builds the workspace graph (which already treats
literal-data contexts as opaque), plus an explicit check for Link Object `operationRef`, which the
core walk doesn't track but which must keep resolving.
