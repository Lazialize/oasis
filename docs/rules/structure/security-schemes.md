# `structure/security-schemes`

This rule checks every Security Scheme Object under `components/securitySchemes` (resolving `$ref`s first, deduplicating by resolved location): it must have a `type` that's recognized for the document's OpenAPI version, and the fields required by that type must be present and correctly shaped — `apiKey` needs a non-empty string `name` and an `in` of `query`/`header`/`cookie`; `http` needs a non-empty string `scheme`; `oauth2` needs a `flows` object defining at least one of `implicit`/`password`/`clientCredentials`/`authorizationCode`, and each declared flow needs its required URL field(s) (`authorizationUrl` and/or `tokenUrl` depending on flow type) plus a `scopes` object; `openIdConnect` needs a non-empty string `openIdConnectUrl`. A security scheme with a missing or wrong-shaped required field will typically be silently ignored or misconfigured by client/server code generators, leaving an API that looks secured in the spec but isn't actually enforceable in generated code.

**Default severity:** `error`

## Version notes

OpenAPI 3.1 adds a `mutualTLS` scheme type (mTLS via the TLS layer, no extra required fields beyond `type`) that does not exist in 3.0; this rule accepts `type: mutualTLS` only on 3.1 documents. On a 3.0 document, `type: mutualTLS` is reported as an unrecognized `type` value (`expected one of: apiKey, http, oauth2, openIdConnect`). All other type-specific required-field checks (apiKey, http, oauth2, openIdConnect) apply identically to both versions.

## Options

No options.

## Examples

### ❌ Bad — OpenAPI 3.0

```yaml
openapi: 3.0.3
components:
  securitySchemes:
    ClientCert:
      type: mutualTLS
```

`Security scheme "ClientCert" has unrecognized "type" value "mutualTLS"; expected one of: apiKey, http, oauth2, openIdConnect.`

### ✅ Good — OpenAPI 3.1

```yaml
openapi: 3.1.0
components:
  securitySchemes:
    ClientCert:
      type: mutualTLS
```

### ❌ Bad — missing required fields

```yaml
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
    BasicAuth:
      type: http
```

Reports `Security scheme "ApiKeyAuth" (apiKey) is missing required field "name" (string).` (and the missing "in"), plus `Security scheme "BasicAuth" (http) is missing required field "scheme" (string).`

### ✅ Good

```yaml
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      name: X-API-Key
      in: header
    BasicAuth:
      type: http
      scheme: basic
```
