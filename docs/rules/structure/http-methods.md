# `structure/http-methods`

This rule checks that every key directly under a Path Item Object (e.g. `paths./pets`) is either a valid HTTP method (`get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace`) or one of the other fields the Path Item Object allows (like `summary`, `description`, `servers`, `parameters`, `$ref`). A typo'd method name (e.g. `fetch` instead of `get`) is silently ignored by most OpenAPI-consuming tooling rather than treated as an operation, so the endpoint quietly disappears from generated clients, docs, and mock servers without any obvious error — this rule catches that class of mistake at lint time.

**Default severity:** `error`

## Version notes

No version-specific behavior — this rule applies identically to OpenAPI 3.0 and 3.1 documents. The set of allowed HTTP methods and non-method Path Item keys is the same in both versions.

## Options

No options.

## Examples

### ❌ Bad

```yaml
paths:
  /pets:
    fetch:
      operationId: listPets
      responses:
        '200':
          description: OK
```

### ✅ Good

```yaml
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
```
