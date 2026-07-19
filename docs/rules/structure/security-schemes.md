# `structure/security-schemes`

This rule checks every Security Scheme Object under `components/securitySchemes` (resolving `$ref`s first, deduplicating by resolved location): it must have a `type` recognized for the document's OpenAPI version, and the fields required by that type must be present and correctly shaped. It validates API key, HTTP, OAuth2, OpenID Connect, and mutual TLS schemes, including each OAuth flow's required URLs and `scopes` object.

**Default severity:** `error`

## Version notes

OpenAPI 3.1 adds `mutualTLS`, which remains available in 3.2. OpenAPI 3.2 additionally adds the OAuth2 `deviceAuthorization` flow (requiring `deviceAuthorizationUrl`, `tokenUrl`, and `scopes`) plus the optional `oauth2MetadataUrl` and `deprecated` fields. These additions are rejected on earlier versions.

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
