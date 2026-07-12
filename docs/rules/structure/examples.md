# `structure/examples`

This rule checks every Example Object in the document — those in `components/examples`, in inline `examples` maps on Media Type Objects and Parameter Objects (resolving `$ref`s along the way) — for structural correctness: only the known keys `summary`, `description`, `value`, `externalValue` (plus `x-` extensions) are allowed; `value` and `externalValue` are mutually exclusive (per spec, an example either embeds its value inline or points to it externally, never both); and `externalValue`, when present, must be a string. An example that sets both `value` and `externalValue`, or uses an unrecognized key, is ambiguous about where the actual example data lives and can confuse doc generators or mock servers that pick one of the two arbitrarily.

**Default severity:** `error`

## Version notes

No version-specific behavior — this rule applies identically to OpenAPI 3.0 and 3.1 documents.

## Options

No options.

## Examples

### ❌ Bad

```yaml
paths:
  /pets:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
              examples:
                bad:
                  value:
                    name: Fido
                  externalValue: https://example.com/pet.json
                  unknownKey: nope
```

Reports `"...examples" example "bad" has unknown key "unknownKey"` and `"...examples" example "bad" must not set both "value" and "externalValue".`

### ✅ Good

```yaml
paths:
  /pets:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
              examples:
                sample:
                  summary: A typical pet
                  value:
                    name: Fido
```
