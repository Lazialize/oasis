# `security/defined`

Requires every scheme name referenced inside a `security` requirement — at the document root or on an individual operation — to actually exist under `components/securitySchemes`. A `security` requirement that names a scheme which was never declared (a typo, a scheme that got renamed or removed, a copy-pasted requirement from another spec) is silently ignored by most tooling rather than erroring, which means the intended access-control requirement quietly doesn't apply. This rule turns that into a diagnostic pointing at the exact offending requirement.

**Default severity:** `error`

## Version notes

This rule checks the root `security` block and every operation's `security` block, walked via the shared operation iterator, which covers 3.1 `webhooks` operations in addition to `paths` operations on both 3.0 and 3.1 documents. There is no other version-specific behavior — `components/securitySchemes` and `security` requirements have the same shape in 3.0 and 3.1.

## Options

No options.

## Examples

### ❌ Bad

```yaml
security:
  - apiKey: []
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
