---
"@oasis/core": patch
"@oasis/bundler": patch
---

fix: bundler and core bug fixes

- `discriminator.mapping` values shaped like a reference (e.g. `dog: './dog.yaml#/Dog'` or `dog: '#/components/schemas/Dog'`) are now discovered by the workspace graph (a file referenced only from a mapping is loaded) and rewritten consistently with the equivalent sibling `$ref` when bundling; bare component-name mapping values (e.g. `cat: Cat`) are left untouched
- `detectVersion` no longer misdetects the OpenAPI version when `openapi:` is written as an unquoted YAML number: `openapi: 3.0` now correctly detects as 3.0 (previously undetectable) and `openapi: 3.10` no longer misdetects as 3.1
- bundling a Path Item `$ref` chain that exceeds the depth guard now emits a warning diagnostic and leaves the `$ref` unresolved in place, instead of incorrectly lifting the Path Item into `components/schemas`
