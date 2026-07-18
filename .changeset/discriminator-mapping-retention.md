---
"@oasis/bundler": patch
---

fix(bundler): retain `discriminator.mapping` targets in `--dereference` bundles. In dereference
mode, a schema reached only by a `oneOf`/`anyOf` `$ref` was inlined and dropped from
`components/*` even when a sibling `discriminator.mapping` entry — an explicit
`#/components/schemas/<Name>` pointer or a bare component name like `dog: Dog` — still pointed at
it. A mapping value is always a bare string and can't hold inlined content, so the bundle ended up
with a dangling mapping target that failed `refs/no-unresolved` and `structure/discriminator` when
linted. Every schema that is a discriminator mapping target (pointer-form or bare name) is now kept
as a real `components/*` entry regardless of whether dereferencing otherwise visited and inlined it
elsewhere (#88).
