# `structure/server-variables`

This rule checks the shape of every Server Object, and its `variables` against the `{var}` templates used in the corresponding `url`, at every level a Server Object can appear (document root, Path Item, and Operation). Shape validation runs first and independently of the `url`/`variables` cross-checks: each array item must be an object, `url` must be present and a string, `variables` (if present) must be an object, and each declared Server Variable Object must have a string `default` — these are reported even when other parts of the Server Object are also malformed. Only once `url` is a valid string do the cross-checks run: every `{var}` placeholder in `url` must have a matching entry in `variables`, and each variable's (if present) `enum` must be a non-empty string-only array that includes the `default` value. It also warns (does not error) when a declared variable is never referenced in `url`. A malformed Server Object, a server URL with an undeclared variable, or a variable whose default isn't a legal value per its own `enum`, breaks URL templating for any client or tool that tries to construct a real base URL from the spec.

**Default severity:** `error`

## Version notes

No version-specific behavior — this rule applies identically to OpenAPI 3.0 and 3.1 documents.

## Options

No options.

## Examples

### ❌ Bad

```yaml
servers:
  - url: https://{host}.example.com/{basePath}/{missingVar}
    variables:
      host:
        default: api
      basePath:
        default: v3
        enum:
          - v1
          - v2
      unused:
        default: x
```

Reports `Root.servers[0] url references "{missingVar}" but "variables" does not define it.`, `Root.servers[0] variable "basePath" "default" must be one of the values listed in "enum".`, and (as a `warn`) `Root.servers[0] declares variable "unused" which is not referenced in "url".`

### ✅ Good

```yaml
servers:
  - url: https://{host}.example.com/{basePath}
    variables:
      host:
        default: api
      basePath:
        default: v1
        enum:
          - v1
          - v2
```
