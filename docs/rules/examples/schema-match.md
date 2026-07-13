# `examples/schema-match`

Checks that `example` values and `examples.<name>.value` entries actually conform to the schema they're attached to, version-aware (the OpenAPI 3.0 Schema Object dialect vs. 3.1's JSON Schema 2020-12 dialect). Examples are meant to be a reliable illustration of the shape data really takes; an example that has drifted out of sync with its schema — after a field was renamed, a type tightened, or a constraint added — misleads anyone reading the spec and any tooling (mocking, codegen, contract tests) that trusts the example as ground truth. This rule validates examples wherever they appear: schema-level `example` keywords found by recursing into nested schemas, and `example`/`examples` on Media Type Objects (in request bodies and responses) and Parameter/Header Objects that carry a `schema` (or `content`) directly.

**Default severity:** `warn`

## Version notes

The rule only runs on documents whose resolved version is `3.0` or `3.1`; validation is version-aware in three specific places carried through from the underlying validator:

- **`type`/`nullable`**: on 3.0, a `nullable: true` schema additionally accepts a `null` example; on 3.1, `null` must appear explicitly in a `type` array (there is no `nullable` keyword in 3.1).
- **`exclusiveMinimum`/`exclusiveMaximum`**: on 3.0 these are booleans that modify `minimum`/`maximum` into exclusive bounds; on 3.1 (true JSON Schema) they are themselves numeric bounds.
- **`prefixItems`**: only consulted on 3.1 documents, for positional array-item validation ahead of `items`.

Schema discovery (for finding schema-level `example` keywords to validate) walks every schema root in the workspace — `components/schemas` plus inline request/response/parameter/header schemas — via the shared schema iterator, which on 3.1 documents also includes schemas reachable from `webhooks` operations. `$ref`s are not followed during this discovery walk (only literal nesting is); a `$ref`'d schema's own `example` is instead picked up when its `components/schemas` entry is visited directly.

## Options

No options.

## Validation subset

This rule hand-rolls a small, honest subset of JSON Schema / OpenAPI Schema Object validation rather than depending on a full JSON Schema library, and it deliberately favors false negatives over false positives.

**Checked:**
- `type` (version-aware per above), including the integer-vs-number distinction (an `integer`-typed schema rejects `1.5` but accepts `5`; a `number`-typed schema accepts both)
- `enum`
- `const` (3.1)
- `required` / `properties` (recursing into each declared property's schema against the corresponding example value)
- `patternProperties` (3.1): each example property is matched against every pattern and validated against all matching schemas; an invalid pattern regex is skipped rather than crashing
- `additionalProperties: false` (flags any example property covered by neither `properties` nor a matching `patternProperties` pattern) and `additionalProperties` as a schema (validates uncovered properties against it)
- `items` (+ 3.1 `prefixItems` for positional validation, with `items` applied to any remaining elements)
- `minItems` / `maxItems`
- `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum` (version-aware boolean vs. numeric exclusive bounds, per above)
- `minLength` / `maxLength` / `pattern` (string length is measured in Unicode code points, per JSON Schema — a supplementary-plane emoji counts as 1, not 2)
- `allOf` (every branch must pass; properties declared by sibling `allOf` branches count as known when one branch sets `additionalProperties: false`, including via `$ref` and nested `allOf`)
- `oneOf` / `anyOf` (at least one branch must pass — `oneOf` exclusivity, i.e. exactly-one-match, is not enforced)

**Deliberately skipped** (to avoid a false positive from a keyword the validator can't confidently evaluate):
- `not`
- `discriminator`
- `unevaluatedProperties` (correct 2020-12 semantics require tracking properties evaluated by every in-place applicator, which this subset validator doesn't model; note that a property matched only by `patternProperties` counts as evaluated for 2020-12 purposes)
- An unresolved or cyclic `$ref` (the `$ref` chain is followed, with cycle detection, until a concrete schema; if any link can't be resolved, validation for that schema is skipped)
- `externalValue` on an Examples Object entry (there's no local value to validate against)

## Examples

### ❌ Bad

```yaml
components:
  schemas:
    Thing:
      type: string
      example: 42
```

### ✅ Good

```yaml
components:
  schemas:
    Thing:
      type: string
      example: "forty-two"
```
