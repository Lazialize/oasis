---
"@oasis/bundler": patch
---

fix(bundler): rewrite `mapping` values only inside actual Discriminator Objects. The bundler
previously rewrote any map reached under a key literally named `mapping`, even when it was an
unrelated OpenAPI 3.1 Schema Object property (3.1 Schema Objects may carry arbitrary custom
vocabulary keywords). `mapping` is now rewritten as a `discriminator.mapping` reference only when
it is the direct child of an actual Discriminator Object (i.e. reached via `Schema.discriminator`),
matching the context tracking `packages/core/src/ref.ts` already used for reference discovery. A
`mapping` property anywhere else is now left untouched as plain data (#97).
