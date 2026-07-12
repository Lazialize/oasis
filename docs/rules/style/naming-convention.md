# `style/naming-convention`

Configurable casing checks for four independent naming targets: operation IDs, component names, parameter names, and schema property names. Consistent naming across an API's surface makes it predictable to consume and easier to generate idiomatic client code from — inconsistent casing (`get_pet_list` next to `listOrders`) is a common source of friction for SDK generators and for developers scanning the spec. This rule is entirely opt-in: with no options configured it is a no-op, so enabling it in your config has zero effect until you name at least one target and a casing style for it.

**Default severity:** `off`

## Version notes

- **Operation IDs and components** are walked via the shared operation/document iterators, which on 3.1 documents include `webhooks` operations alongside `paths` operations.
- **Component names** (`componentName`) check every `components/*` group covered by `COMPONENT_SECTIONS` — `schemas`, `responses`, `parameters`, `examples`, `requestBodies`, `headers`, `securitySchemes`, `links`, `callbacks` — and additionally `components/pathItems`, the 3.1-only section for reusable Path Item Objects. On a 3.0 document `pathItems` simply won't appear, so this is transparent across versions.
- **Property names** (`propertyName`) recurse into schemas reachable via `properties`, `items`, `additionalProperties`, `allOf`, `oneOf`, and `anyOf`. On 3.1 documents, `patternProperties` keys are deliberately *not* checked, since those keys are regular expressions, not literal property names, and would produce nonsensical casing violations.
- **Numeric bounds and other keywords are unaffected** — this rule is unrelated to schema validation; its only version sensitivity is the `pathItems` component section and the `patternProperties` exclusion above.

## Options

Off by default: this rule does nothing unless you supply an options object naming at least one of four optional keys. Each key takes one of five casing styles: `camelCase`, `PascalCase`, `snake_case`, `kebab-case`, `SCREAMING_SNAKE_CASE`.

| Option | Checks |
| --- | --- |
| `operationId` | Every operation's `operationId`. |
| `componentName` | The key of every entry under each `components/*` group (see Version notes for which groups). |
| `parameterName` | The `name` of every Parameter Object reachable from path items, operations, and `components/parameters`, deduplicated so a parameter shared via `$ref` is only checked once. Parameters with `in: header` are exempt — HTTP header names are conventionally kebab/mixed case and case-insensitive on the wire, so they're not held to the configured style. |
| `propertyName` | The key of every entry under a schema's `properties` map, recursively (see Version notes for the traversal rules and the `patternProperties` exclusion). |

Casing matching is pragmatic rather than a strict grammar: a name with no separators (a single word) satisfies any style that doesn't require a specific leading-letter case, and digits may lead or trail a word or segment (`oauth2Token`, `v2_id` are both accepted). What's rejected is a separator or letter-case inconsistent with the style itself — an underscore inside `camelCase`, an uppercase letter inside `snake_case`, and so on. An empty string never matches any style.

```jsonc
{
  "lint": {
    "rules": {
      "style/naming-convention": [
        "warn",
        {
          "operationId": "camelCase",
          "componentName": "PascalCase",
          "parameterName": "camelCase",
          "propertyName": "camelCase"
        }
      ]
    }
  }
}
```

Invalid options (an unknown key, a non-string value, or a value that isn't one of the five recognized casing styles) surface as an `oasis/config` diagnostic rather than crashing the linter, and the rule falls back to its default (off, no options) for that run.

## Examples

### ❌ Bad — `operationId: camelCase`

```yaml
paths:
  /pets:
    get:
      operationId: get_pet_list
      responses:
        '200':
          description: OK
```

### ✅ Good — `operationId: camelCase`

```yaml
paths:
  /pets:
    get:
      operationId: getPetList
      responses:
        '200':
          description: OK
```

### ❌ Bad — `componentName: PascalCase`

```yaml
components:
  schemas:
    pet_response:
      type: object
```

### ✅ Good — `componentName: PascalCase`

```yaml
components:
  schemas:
    PetResponse:
      type: object
```
