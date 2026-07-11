# Petstore demo

A small multi-file OpenAPI 3.0 project for trying out `oasis`. Path items live in
`paths/*.yaml`, schemas in `schemas/*.yaml`, and the shared `Error` schema is referenced
*back* into the entry document from the path files.

It contains **three deliberate lint findings** (marked with comments in the sources):

- `path-params-defined` (error) — `GET /pets/{petId}` never declares the `petId` parameter
- `operation-description` (warning) — `POST /pets` has no description/summary
- `no-unused-components` (warning) — `LegacyPet` is referenced by nothing

`oasis.config.jsonc` here turns `no-ref-cycle` off, since the path-file → entry back-references
are intentional. It is discovered automatically when you run from this directory (or pass
`--config`).

`oasis.config.jsonc` also declares `"entries": ["openapi.yaml"]`, which turns on LSP **project
mode**: opening this folder in an editor lints every file in `openapi.yaml`'s workspace graph
immediately, with nothing open, and treats `paths/*.yaml`/`schemas/*.yaml` as members of that
graph rather than as broken standalone documents (they have no top-level `openapi:` key of their
own). Opening `paths/pets.yaml` directly still gets diagnostics, go-to-definition, hover, and
`$ref` completion against the shared `openapi.yaml` components.

```sh
# from the repo root (after `bun run build:bin`)
./dist/oasis lint examples/petstore/openapi.yaml --config examples/petstore/oasis.config.jsonc
./dist/oasis bundle examples/petstore/openapi.yaml -o petstore.bundled.yaml

# or from this directory — the config is picked up automatically
cd examples/petstore
../../dist/oasis lint openapi.yaml

# or with no entry at all — discovers oasis.config.jsonc and lints its "entries"
cd examples/petstore
../../dist/oasis lint
```

Open this folder in VS Code with the Oasis extension to see the same findings as squiggles,
jump through `$ref`s with F12, and get completion for keys and `$ref` targets.
