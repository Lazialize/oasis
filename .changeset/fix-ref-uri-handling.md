---
"@oasis/core": patch
"@oasis/bundler": patch
---

Fix four `$ref`/pointer handling bugs: (1) a `$ref`'s file and fragment parts are now percent-decoded (`./petstore%20v2.yaml` resolves the file `petstore v2.yaml`; fragment segments are percent-decoded before `~1`/`~0` unescaping), tolerating a malformed `%` instead of throwing; (2) a literal `{"$ref": ...}` value nested under a schema's `example`/`default`/`enum`/`const` (or a 3.1 `examples` array) is treated as plain data instead of a reference, so it no longer triggers a spurious unresolved-ref diagnostic during graph loading or gets rewritten by the bundler; (3) the bundler now preserves `summary`/`description` siblings on a Path Item `$ref` (3.1) in both the resolved and unresolved cases instead of dropping them; (4) `nodeAtPosition` now resolves a cursor on a map *key* (not just its value) to that pair's pointer, fixing hover/definition/rename on a `$ref` (or any) key.
