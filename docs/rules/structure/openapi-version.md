# `structure/openapi-version`

This rule checks that the document's `openapi` field is a string matching the pattern `3.0.x` or `3.1.x`. It exists to catch documents that declare an unsupported or malformed version — most commonly a Swagger 2.0 document (`openapi: "2.0"`, or really a `swagger: "2.0"` field with no `openapi` at all) being fed to tooling that only understands OpenAPI 3.x, or a typo'd/placeholder version string. Without this check, downstream tooling could misinterpret the document's structure (Swagger 2.0 and OpenAPI 3.x have materially different shapes for things like parameters, request bodies, and security) and fail confusingly deep into processing rather than up front.

**Default severity:** `error`

## Version notes

No version-specific behavior — this rule applies identically to OpenAPI 3.0 and 3.1 documents; it only accepts version strings that match `3.0.x` or `3.1.x`, and treats any other value (including `2.0`) as invalid. If the `openapi` field is entirely absent, this rule does not report anything — that is `structure/required-fields`'s responsibility.

## Options

No options.

## Examples

### ❌ Bad

```yaml
openapi: "2.0"
info:
  title: T
  version: "1.0.0"
paths: {}
```

### ✅ Good

```yaml
openapi: 3.0.3
info:
  title: T
  version: "1.0.0"
paths: {}
```
