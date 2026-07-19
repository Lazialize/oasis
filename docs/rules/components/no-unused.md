# `components/no-unused`

Flags components declared under `components/*` that are never referenced anywhere in the workspace. A component counts as "used" if it is targeted by a `$ref` (resolved across files) — including a `$ref` into the component's *interior*, e.g. `#/components/schemas/Foo/properties/id`, which marks `Foo` itself as used — if it's a security scheme named in a `security` requirement (root- or operation-level, including 3.1 webhook operations), or if it's a schema named (by URI reference or bare component name) in a `discriminator.mapping` value — even when the enclosing schema with the `discriminator` isn't itself reachable. Everything else under `components/schemas`, `responses`, `parameters`, `examples`, `requestBodies`, `headers`, `securitySchemes`, `links`, and `callbacks` that nothing points to is dead weight in the document: it bloats the spec, misleads readers into thinking it's part of the actual API surface, and often signals a stale or half-finished edit.

**Default severity:** `warn`

## Version notes

This rule walks all version-appropriate operations to collect component usage, including 3.1/3.2 `webhooks` and 3.2 `query`/`additionalOperations`. OpenAPI 3.2 `components/mediaTypes` entries participate in unused detection. `components/pathItems` remains explicitly excluded because unused detection for that section is not yet supported.

## Options

No options.

## Examples

### ❌ Bad

```yaml
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
components:
  schemas:
    Orphan:
      type: object
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
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
components:
  schemas:
    Pet:
      type: object
```
