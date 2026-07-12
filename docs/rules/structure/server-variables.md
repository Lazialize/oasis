# `structure/server-variables`

This rule checks Server Object `variables` against the `{var}` templates used in the corresponding `url`, at every level a Server Object can appear (document root, Path Item, and Operation): every `{var}` placeholder in `url` must have a matching entry in `variables`, and each variable entry must have a string `default`, plus (if present) a non-empty string-only `enum` that includes the `default` value. It also warns (does not error) when a declared variable is never referenced in `url`. A server URL with an undeclared variable, or a variable whose default isn't a legal value per its own `enum`, breaks URL templating for any client or tool that tries to construct a real base URL from the spec.

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
