# `security/defined`

Requires every scheme name referenced inside a `security` requirement — at the document root or on an individual operation — to actually exist under the *entry document's* `components/securitySchemes`. Requirement keys are implicit component-name references and per OpenAPI scope rules resolve against the entry document of the API description; a same-named scheme declared in an unrelated referenced file does not satisfy a requirement. A `security` requirement that names a scheme which was never declared (a typo, a scheme that got renamed or removed, a copy-pasted requirement from another spec) is silently ignored by most tooling rather than erroring, which means the intended access-control requirement quietly doesn't apply. This rule turns that into a diagnostic pointing at the exact offending requirement.

The rule also validates the value list inside each requirement:

- For an `oauth2` scheme, every requested scope must be declared by at least one of the scheme's `flows.*.scopes` maps — an undeclared scope is reported (on both 3.0 and 3.1).
- For scheme types other than `oauth2` and `openIdConnect` (`apiKey`, `http`, `mutualTLS`): on **OpenAPI 3.0** the array must be empty (only `oauth2`/`openIdConnect` requirements may list scopes); on **OpenAPI 3.1** the Security Requirement Object explicitly allows role names in the array for these scheme types, so non-empty arrays are accepted.
- `openIdConnect` scope names live in the provider's discovery document and cannot be validated statically, so any scope list is accepted there.

**Default severity:** `error`

## Version notes

This rule checks the root `security` block and every operation's `security` block, walked via the shared operation iterator, which covers 3.1 `webhooks` operations in addition to `paths` operations on both 3.0 and 3.1 documents. Non-OAuth requirement arrays are version-specific: 3.0 requires them to be empty, while 3.1 allows role names there (see above). `components/securitySchemes` and `security` requirements otherwise have the same shape in 3.0 and 3.1.

## Options

No options.

## Examples

### ❌ Bad

```yaml
security:
  - apiKey: []          # not declared under components/securitySchemes
  - oauth: [write:pets] # scope not declared by any of the scheme's flows
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
components:
  securitySchemes:
    basicAuth:
      type: http
      scheme: basic
    oauth:
      type: oauth2
      flows:
        implicit:
          authorizationUrl: https://example.com/auth
          scopes:
            read:pets: Read pets
```

### ✅ Good

```yaml
security:
  - basicAuth: []
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
components:
  securitySchemes:
    basicAuth:
      type: http
      scheme: basic
```
