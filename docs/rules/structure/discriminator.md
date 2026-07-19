# `structure/discriminator`

This rule checks Discriminator Objects on every schema in the document (including inline ones): `discriminator.propertyName` is required and must be a non-empty string; `discriminator.mapping` (if present) must be an object whose values are strings, and each mapping value must resolve to an actual schema in the workspace — a bare component name (matching `^[a-zA-Z0-9._-]+$`, containing neither `/` nor `:`) is shorthand for `#/components/schemas/<name>`, while any other value (a relative path like `./dog.yaml`, a fragment pointer, a percent-encoded reference) is a URI reference resolved with normal `$ref` semantics; absolute non-filesystem URIs (`https:`, `urn:`, ...) are external targets and are skipped by this rule; and for each resolvable `oneOf`/`anyOf` branch schema, the discriminator's `propertyName` must actually be defined in that branch's **effective** `properties`. "Effective" means the rule flattens the branch's `allOf` members and follows `$ref`s (local, nested, and cross-file) before looking for the property, so a branch that inherits `propertyName` from a base schema via `allOf` is accepted — `$ref` cycles are broken safely. A schema declaring `discriminator` **without** `oneOf`/`anyOf` is treated as the OpenAPI parent-discriminator pattern (children reference the parent through their own `allOf`): it is accepted as long as the parent schema itself effectively defines `propertyName`. A discriminator that references a mapping target or property that doesn't exist breaks polymorphic (de)serialization at runtime for any client generated from the spec — this is a class of bug that's invisible just by reading the YAML since it depends on matching names across the mapping, the branch schemas, and their properties.

**Default severity:** `error`

## Version notes

In **OpenAPI 3.0**, the spec additionally requires that a discriminator's `propertyName` be listed in the branch schema's own effective `required` array (not just present in `properties`) — this rule enforces that only on 3.0 documents. In **OpenAPI 3.1/3.2**, this additional constraint does not apply. OpenAPI 3.2 adds `defaultMapping`; the rule validates and resolves it, and requires it when the discriminating property is defined but optional.

## Options

No options.

## Examples

### ❌ Bad — OpenAPI 3.0

```yaml
openapi: 3.0.3
components:
  schemas:
    Pet:
      discriminator:
        propertyName: petType
      oneOf:
        - $ref: '#/components/schemas/Cat'

    Cat:
      type: object
      properties:
        petType:
          type: string
      # missing: required: [petType]
```

`... discriminator property "petType" must be listed in "required" of "oneOf[0]" schema (OpenAPI 3.0 requires discriminator properties to be required).`

### ✅ Good — OpenAPI 3.0

```yaml
openapi: 3.0.3
components:
  schemas:
    Pet:
      discriminator:
        propertyName: petType
      oneOf:
        - $ref: '#/components/schemas/Cat'

    Cat:
      type: object
      required: [petType]
      properties:
        petType:
          type: string
```

### ✅ Good — OpenAPI 3.1

```yaml
openapi: 3.1.0
components:
  schemas:
    Pet:
      discriminator:
        propertyName: petType
      oneOf:
        - $ref: '#/components/schemas/Cat'

    Cat:
      type: object
      properties:
        petType:
          type: string
      # "required" is not needed on 3.1
```

### ✅ Good — branch inherits the property through `allOf` (both versions)

```yaml
components:
  schemas:
    Base:
      type: object
      required: [kind] # required only matters on 3.0
      properties:
        kind:
          type: string
    Cat:
      allOf:
        - $ref: '#/components/schemas/Base'
        - type: object
          properties:
            meow:
              type: boolean
    Animal:
      oneOf:
        - $ref: '#/components/schemas/Cat' # `kind` comes from Base via allOf
      discriminator:
        propertyName: kind
```

### ✅ Good — parent-discriminator pattern (no `oneOf`/`anyOf`)

```yaml
components:
  schemas:
    Pet:
      type: object
      required: [petType] # required only matters on 3.0
      properties:
        petType:
          type: string
      discriminator: # valid: Pet itself defines petType; children reference it via allOf
        propertyName: petType
    Cat:
      allOf:
        - $ref: '#/components/schemas/Pet'
```

### ❌ Bad — mapping to a missing schema (both versions)

```yaml
components:
  schemas:
    Pet:
      discriminator:
        propertyName: petType
        mapping:
          cat: '#/components/schemas/Cat'
          dog: '#/components/schemas/NoSuchSchema'
      oneOf:
        - $ref: '#/components/schemas/Cat'
```

`... "discriminator.mapping" entry "dog" -> "#/components/schemas/NoSuchSchema" does not resolve to a schema in the workspace.`
