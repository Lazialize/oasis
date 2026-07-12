# Attribution

Vendored real-world OpenAPI documents used as smoke-test fixtures for `real-world.test.ts`.
All files were fetched as-is (network access available at the time) and are unmodified except
for a two-line source comment header prepended to each.

## `vendor/petstore.yaml`

- Source: https://github.com/OAI/OpenAPI-Specification (`_archive_/schemas/v3.0/pass/petstore.yaml`
  on the `main` branch — the classic Swagger Petstore 3.0 example historically published under
  `examples/v3.0/petstore.yaml`)
- License: Apache-2.0
- Fetched: 2026-07-12

## `vendor/petstore-expanded.yaml`

- Source: https://github.com/OAI/OpenAPI-Specification
  (`_archive_/schemas/v3.0/pass/petstore-expanded.yaml` on the `main` branch)
- License: Apache-2.0
- Fetched: 2026-07-12

## `vendor/webhook-example.yaml`

- Source: https://github.com/OAI/learn.openapis.org (`examples/v3.1/webhook-example.yaml`)
- License: CC-BY-4.0
- Fetched: 2026-07-12

## `vendor/non-oauth-scopes.yaml`

- Source: https://github.com/OAI/learn.openapis.org (`examples/v3.1/non-oauth-scopes.yaml`)
- License: CC-BY-4.0
- Fetched: 2026-07-12
- Modified: the upstream snippet is a documentation fragment illustrating the `security` field
  only and omits the Operation Object's required `responses` field, so it isn't a complete/valid
  document on its own. Added a minimal `responses: { '200': { description: OK } }` so it parses
  as a standalone valid document; no other content changed.

## `kitchen-sink/*`

Synthetic documents authored for this repo (not vendored), exercising every OpenAPI 3.0/3.1
feature the `structure/*` lint rules inspect. No external license applies; covered by this
repo's own license.
