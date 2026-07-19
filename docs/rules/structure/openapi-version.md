# `structure/openapi-version`

This rule checks that the document's `openapi` field is a string matching the pattern `3.0.x`, `3.1.x`, or `3.2.x`, optionally with a prerelease suffix (e.g., `3.2.0-rc1`). It exists to catch documents that declare an unsupported or malformed version — most commonly a Swagger 2.0 document (`openapi: "2.0"`, or really a `swagger: "2.0"` field with no `openapi` at all) being fed to tooling that only understands OpenAPI 3.x, or a typo'd/placeholder version string. Without this check, downstream tooling could misinterpret the document's structure (Swagger 2.0 and OpenAPI 3.x have materially different shapes for things like parameters, request bodies, and security) and fail confusingly deep into processing rather than up front.

**Default severity:** `error`

## Version notes

The rule accepts `3.0.x`, `3.1.x`, and `3.2.x` with optional prerelease suffixes (e.g., `3.0.0-rc1`, `3.2.0-alpha.1`) and treats any other value (including `2.0`) as invalid. On 3.2 documents it also checks that `$self`, when present, is a non-empty string. If the `openapi` field is entirely absent, this rule does not report anything — that is `structure/required-fields`'s responsibility.

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

Prerelease versions (release candidates, alpha, beta) are also accepted:

```yaml
openapi: 3.1.0-rc1
info:
  title: T
  version: "1.0.0"
paths: {}
```
