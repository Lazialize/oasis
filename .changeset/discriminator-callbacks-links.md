---
"@oasis/linter": minor
---

Three new `structure/*` rules cover more of the OpenAPI object model: `structure/discriminator`
(Discriminator Object: required `propertyName`, `mapping` targets resolve in-workspace, a
discriminator requires `oneOf`/`anyOf`/`allOf` on the same schema, and `propertyName` must be a
property of — and, in OpenAPI 3.0, required by — each resolvable `oneOf`/`anyOf` branch schema),
`structure/callbacks` (Callback Object: expression keys look like runtime expressions or URLs,
mapped Path Item Objects have valid keys, and their operations declare `responses`), and
`structure/links` (Link Object: exactly one of `operationRef`/`operationId` is set, `operationId`
matches an operationId in the workspace, and local `#/paths/...`/`#/webhooks/...` `operationRef`
pointers resolve). All default to `error` severity.
