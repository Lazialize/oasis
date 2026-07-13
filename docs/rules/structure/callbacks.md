# `structure/callbacks`

This rule checks Callback Objects — both operation-level `callbacks` and `components/callbacks` — resolving `$ref`s and deduplicating by resolved location. Each expression key in a Callback Object must look like a runtime expression (containing `{$...}`, e.g. `{$request.body#/callbackUrl}`) or a URL; an empty key or one that's neither is flagged. Each key's value must be a valid Path Item Object, reusing the same key-shape rules as `structure/http-methods` (only HTTP methods and allowed metadata fields), and each operation defined on it must at least declare `responses` — and, when present, that Responses Object must not be empty (it must contain at least one response code, `default`, or extension field). Callbacks describe out-of-band requests the API will make back to the caller (e.g. webhooks); a malformed callback expression or an operation missing/empty `responses` means client tooling can't tell what shape of request to expect or how to validate the response.

**Default severity:** `error`

## Version notes

No version-specific behavior — this rule applies identically to OpenAPI 3.0 and 3.1 documents.

## Options

No options.

## Examples

### ❌ Bad

```yaml
paths:
  /subscribe:
    post:
      operationId: subscribe
      responses:
        '200':
          description: OK
      callbacks:
        badExpr:
          notAnExpression:
            post:
              responses:
                '200':
                  description: OK
        missingResponses:
          '{$request.body#/url}':
            post:
              operationId: noResponses
```

Reports `Callback "badExpr" ... key "notAnExpression" does not look like a runtime expression (e.g. containing "{$request.body#/...}") or a URL.` and `Callback "missingResponses" (...).post is missing required field "responses".`

### ✅ Good

```yaml
paths:
  /subscribe:
    post:
      operationId: subscribe
      responses:
        '200':
          description: OK
      callbacks:
        onData:
          '{$request.body#/callbackUrl}':
            post:
              operationId: onDataCallback
              responses:
                '200':
                  description: OK
```
