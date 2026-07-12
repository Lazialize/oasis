# `refs/no-cycle`

Flags circular `$ref` chains across files — e.g. file A's `$ref` points into file B, and (transitively) back into file A. This rule doesn't run its own detection; it surfaces `no-ref-cycle` diagnostics that `@oasis/core` already records on the workspace graph while it loads and follows `$ref`s across files. Circular file references cause infinite loops for any tool that naively dereferences `$ref`s (bundlers, schema flatteners, some client generators), so they need to be caught and reported rather than silently followed forever.

**Default severity:** `warn`

## Version notes

Detection happens in `@oasis/core`'s workspace-graph loader, which only tracks cycles formed by **cross-file** `$ref`s (a `$ref` whose file part points at another file, followed while that file is still being loaded/"visited"). A same-document `$ref` cycle (e.g. a schema that circularly references itself within one file via `#/...` pointers) is not what this diagnostic is for — recursive same-file schema references are normal/expected (e.g. a `Node` schema with a `children` property referencing itself) and are not flagged. This rule itself has no version-specific branching: it just relays whatever `no-ref-cycle` diagnostics already exist on `ctx.graph.diagnostics`, and file-following happens the same way regardless of whether the document is OpenAPI 3.0 or 3.1.

## Options

No options.

## Examples

### ❌ Bad

`entry.yaml`:
```yaml
openapi: 3.0.3
info:
  title: Cycle
  version: "1.0.0"
paths: {}
components:
  schemas:
    A:
      $ref: './other.yaml#/components/schemas/B'
```

`other.yaml`:
```yaml
components:
  schemas:
    B:
      $ref: './entry.yaml#/components/schemas/A'
```

### ✅ Good

`entry.yaml`:
```yaml
openapi: 3.0.3
info:
  title: NoCycle
  version: "1.0.0"
paths: {}
components:
  schemas:
    A:
      $ref: './other.yaml#/components/schemas/B'
```

`other.yaml`:
```yaml
components:
  schemas:
    B:
      type: object
      properties:
        id:
          type: string
```
