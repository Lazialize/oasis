---
"@oasis/core": patch
"@oasis/server": patch
---

fix(server): the extract/inline relocation planner now uses core's semantic reference discovery
instead of a raw `$ref` key walk. Genuine references — real `$ref`s and `discriminator.mapping`
URI values — are rebased to preserve their canonical targets across directories, while
`$ref`-shaped scalars buried in literal instance data (`example`/`default`/`enum`/`const`) are left
untouched. Adds `findSubtreeRefs` to `@oasis/core` so the planner shares the exact literal-context
and discriminator rules used by linting and graph loading (#119).
