# `structure/schema-keywords`

This rule validates the keywords used inside every schema in the document (walked through `properties`, `items`, `additionalProperties`, `not`, `allOf`/`oneOf`/`anyOf`, and, on 3.1, `prefixItems`/`patternProperties`/`if`/`then`/`else`/`$defs`) against the Schema Object dialect of the document's OpenAPI version, plus a set of version-independent structural and consistency checks:

- **Dialect-restricted keywords**: on OpenAPI 3.0, keywords that only exist in JSON Schema 2020-12 (`const`, `prefixItems`, `contentMediaType`, `contentEncoding`, `patternProperties`, `propertyNames`, `unevaluatedProperties`, `unevaluatedItems`, `dependentRequired`, `dependentSchemas`, `if`/`then`/`else`, `$defs`, `examples`) are flagged as unsupported.
- **`type`**: must be a recognized type name for the version (a string in 3.0; a string or array of strings in 3.1, with array entries checked for validity and duplicates).
- **`exclusiveMinimum`/`exclusiveMaximum`**: must be the boolean form in 3.0 and the numeric form in 3.1; any other node kind (object, array, `null`, string, ...) is flagged too, not just the other version's scalar form.
- **Numeric keywords**: `minimum`/`maximum` must be numbers, `multipleOf` must be a number greater than 0, and `minLength`/`maxLength`/`minItems`/`maxItems`/`minProperties`/`maxProperties` must be non-negative integers.
- **Internal consistency**: a `min*`/`max*` pair (`minimum`/`maximum`, `minLength`/`maxLength`, `minItems`/`maxItems`, `minProperties`/`maxProperties`) where the minimum exceeds the maximum makes the schema unsatisfiable and is flagged; likewise a `required` property that's excluded by `properties` + `additionalProperties: false` is flagged as unsatisfiable.
- **`pattern`**: must be a string that's a valid regular expression.
- **`required`**: must be a non-empty array of strings with no duplicates.
- **`enum`**: must be a non-empty array.
- **`items`**: must be a single schema object (not an array/tuple) in either version — tuple typing uses `prefixItems` (3.1-only).
- **`properties`/`additionalProperties`**: `properties` must be an object; `additionalProperties` must be a boolean or a schema object.
- **`format`**: must be a string.
- **`$ref` siblings** (3.0 only): in OpenAPI 3.0, a Reference Object with `$ref` alongside other keys silently ignores those other keys per spec, so this rule flags any sibling keys next to `$ref` (3.1 permits `$ref` siblings, since 3.1's Reference Object is unrestricted JSON Schema).

Together these catch schemas that look plausible but are either invalid for the declared dialect or are self-contradictory in a way that would make every value fail validation — both classes of bug are easy to introduce by hand and hard to notice without a checker, since most editors won't flag them.

**Default severity:** `error`

## Version notes

Several checks are dialect-specific, as detailed above: `ONLY_31_KEYWORDS` are flagged only on 3.0 documents; `exclusiveMinimum`/`exclusiveMaximum` expect the boolean form on 3.0 and the numeric form on 3.1; `type` accepts only a single string on 3.0 versus a string or array on 3.1 (with 3.0 `type` arrays and `type: null` left to `structure/schema-nullable` rather than double-reported here); and `$ref` sibling keys are only flagged on 3.0. On 3.1 documents specifically, a `required` name matched by a `patternProperties` pattern is not flagged as unsatisfiable under `additionalProperties: false`. All other checks (numeric bounds, `pattern`, `required`, `enum`, `items` shape, `properties`/`additionalProperties` shape, `format`, min/max consistency) apply identically to both versions.

## Options

No options.

## Examples

### ❌ Bad — OpenAPI 3.0

```yaml
openapi: 3.0.3
components:
  schemas:
    Widget:
      $ref: '#/components/schemas/Base'
      description: extra field ignored alongside $ref in 3.0
    Range:
      type: integer
      minimum: 10
      maximum: 5
      prefixItems:
        - type: string
```

Reports `Sibling keys alongside "$ref" ("description") are ignored in OpenAPI 3.0 Reference Objects`, `"minimum" (10) is greater than "maximum" (5); this schema can never be satisfied.`, and `"prefixItems" is not supported in OpenAPI 3.0; it's a JSON Schema 2020-12 keyword available in OpenAPI 3.1.`

### ✅ Good — OpenAPI 3.0

```yaml
openapi: 3.0.3
components:
  schemas:
    Range:
      type: integer
      minimum: 5
      maximum: 10
```

### ❌ Bad — OpenAPI 3.1

```yaml
openapi: 3.1.0
components:
  schemas:
    Widget:
      type: [string, string]
      exclusiveMinimum: true
```

Reports `"type" array contains duplicate entry "string".` and `"exclusiveMinimum" must be a number in OpenAPI 3.1 (JSON Schema 2020-12); the boolean form alongside "minimum"/"maximum" is OpenAPI 3.0.`

### ✅ Good — OpenAPI 3.1

```yaml
openapi: 3.1.0
components:
  schemas:
    Widget:
      type: [string, "null"]
      minLength: 1
      exclusiveMinimum: 0
```
