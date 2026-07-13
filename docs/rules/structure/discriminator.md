# `structure/discriminator`

This rule checks Discriminator Objects on every schema in the document (including inline ones): a schema declaring `discriminator` must also use `oneOf`, `anyOf`, or `allOf`, since discriminators only make sense alongside schema composition; `discriminator.propertyName` is required and must be a non-empty string; `discriminator.mapping` (if present) must be an object whose values are strings, and each mapping value must resolve to an actual schema in the workspace — a bare component name (matching `^[a-zA-Z0-9._-]+$`, containing neither `/` nor `:`) is shorthand for `#/components/schemas/<name>`, while any other value (a relative path like `./dog.yaml`, a fragment pointer, a percent-encoded reference) is a URI reference resolved with normal `$ref` semantics; absolute non-filesystem URIs (`https:`, `urn:`, ...) are external targets and are skipped by this rule; and for each resolvable `oneOf`/`anyOf` branch schema, the discriminator's `propertyName` must actually be defined in that branch's `properties`. A discriminator that references a mapping target or property that doesn't exist breaks polymorphic (de)serialization at runtime for any client generated from the spec — this is a class of bug that's invisible just by reading the YAML since it depends on matching names across the mapping, the branch schemas, and their properties.

**Default severity:** `error`

## Version notes

In **OpenAPI 3.0**, the spec additionally requires that a discriminator's `propertyName` be listed in the branch schema's own `required` array (not just present in `properties`) — this rule enforces that only on 3.0 documents, reporting a branch schema whose `required` doesn't include the discriminator property. In **OpenAPI 3.1**, this additional `required` constraint does not apply; a branch schema only needs `propertyName` defined in `properties`, it need not be `required`. All other checks (composition presence, `propertyName` shape, `mapping` resolution, property presence in branches) apply identically to both versions.

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
