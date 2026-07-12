---
"@oasis/bundler": minor
"@oasis/cli": minor
---

`oasis bundle --dereference` fully inlines every `$ref` — internal and external — as a deep,
recursive copy of its resolved target, instead of lifting external refs into `components/*`.
Components only reachable via a (now-inlined) `$ref` are dropped from the output; components
unreachable from anywhere are kept verbatim, matching the existing (non-dereferenced) bundle
behavior for unreferenced entry components. A `$ref` whose expansion would revisit a target
already being expanded (a reference cycle) can't be inlined: that occurrence is kept as a `$ref`
to a minimal `components/*` entry for the cycle's target, and a warning diagnostic is emitted
naming the cycle. Output is deterministic (same input → byte-identical output). The bundler's
`bundle()` entry point gains an additive `dereference` option (default `false`).
