# `components/no-unused`

Flags components declared under `components/*` that are never referenced anywhere in the workspace. A component counts as "used" if it is targeted by a `$ref` (resolved across files), if it's a security scheme named in a `security` requirement (root- or operation-level, including 3.1 webhook operations), or if it's a schema named (by pointer or bare component name) in a `discriminator.mapping` value — even when the enclosing schema with the `discriminator` isn't itself reachable. Everything else under `components/schemas`, `responses`, `parameters`, `examples`, `requestBodies`, `headers`, `securitySchemes`, `links`, and `callbacks` that nothing points to is dead weight in the document: it bloats the spec, misleads readers into thinking it's part of the actual API surface, and often signals a stale or half-finished edit.

**Default severity:** `warn`

## Version notes

This rule walks operations (via the shared operation iterator) to collect `security` requirement usage, which includes 3.1 `webhooks` operations alongside `paths` operations — a security scheme referenced only from a webhook's `security` block is correctly treated as used. `components/pathItems`, the 3.1-only component section for reusable Path Item Objects, is explicitly excluded from this rule's unused-detection (see `COMPONENT_CATEGORIES` in the source, which filters it out of the shared `COMPONENT_SECTIONS` list) — unused-detection for that section isn't supported yet, so entries there are never flagged regardless of version.

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
