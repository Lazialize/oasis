---
"@oasis/linter": patch
---

Harden several `structure/*` rules that were silently skipping malformed input instead of reporting it:

- `structure/schema-keywords` now reports `exclusiveMinimum`/`exclusiveMaximum` values of any non-conforming node kind (object, array, `null`, string, ...), not just the other version's scalar form (#41)
- `structure/field-types` and `structure/callbacks` now flag a present but empty Responses Object (`responses: {}`), requiring at least one response code, `default`, or extension (`x-*`) field (#44)
- `structure/server-variables` now validates Server Object shape (array item is an object, `url` present and a string, `variables` is an object) at root/Path Item/Operation level instead of silently skipping malformed entries; variable `default`/`enum` checks still run afterward (#45)
- `structure/field-types` now validates every Parameter Object consistently, wherever it's legal to appear: `components/parameters`, Path Item and Operation `parameters`, and local/external Reference Objects to any of those (previously only some inline operation-level parameters were checked). Adds required `name`/`in`, `in: path` requiring `required: true`, `schema`/`content` exclusivity, and `style`/`explode`/`allowEmptyValue`/`allowReserved` constraints; `collectParameterObjects` now resolves `components/parameters` entries through the workspace graph like every other components-level collector (#46)
