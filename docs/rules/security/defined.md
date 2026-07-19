# `security/defined`

Requires every scheme referenced inside a `security` requirement — at the document root or on an individual operation — to resolve to a Security Scheme Object. Component-name keys resolve against the *entry document's* `components/securitySchemes`; a same-named scheme declared in an unrelated referenced file does not satisfy a requirement. OpenAPI 3.2 additionally allows a key to be a URI reference when it does not collide with a component name. Oasis resolves local/file URI targets through the workspace graph and accepts absolute network URIs without fetching them.

The rule also validates the value list inside each requirement:

- For an `oauth2` scheme, every requested scope must be declared by at least one of the scheme's `flows.*.scopes` maps — an undeclared scope is reported.
- For scheme types other than `oauth2` and `openIdConnect` (`apiKey`, `http`, `mutualTLS`): on **OpenAPI 3.0** the array must be empty; on **OpenAPI 3.1/3.2** role names are accepted.
- `openIdConnect` scope names live in the provider's discovery document and cannot be validated statically, so any scope list is accepted there.

**Default severity:** `error`

## Version notes

This rule checks the root `security` block and every operation's `security` block, including `webhooks`, 3.2 `query`, and `additionalOperations`. Non-OAuth requirement arrays are version-specific: 3.0 requires them to be empty, while 3.1/3.2 allow role names. URI-form Security Requirement keys are supported only in 3.2, with component-name lookup taking precedence.

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
