# `operation/success-response`

Requires every operation to declare at least one 2xx or 3xx response in its `responses` object (matching a literal status code like `200` or a range key like `2XX`); a `default` response entry alone does not satisfy the rule, and a missing `responses` object entirely is also flagged. An operation with no documented success path is ambiguous to both API consumers and code generators — callers can't tell what a successful call actually returns, and generators can't produce a typed success return value, only an error/default fallback.

**Default severity:** `warn`

## Version notes

Operations are enumerated with `iterateOperations`, which on a 3.1 document also includes operations under the root `webhooks` map, not just `paths`. A webhook operation whose `responses` has only a `default` entry (or is missing entirely) is flagged the same way as a `paths` operation. On a 3.0 document there is no `webhooks` map to walk. The success-status detection logic (`^[23](\d{2}|XX)$`, matching e.g. `200`, `2XX`, `304`) is unchanged between versions.

## Options

No options.

## Examples

### ❌ Bad

```yaml
paths:
  /pets:
    get:
      operationId: listPets
      tags: [pets]
      description: List all pets.
      responses:
        default:
          description: Unexpected error
```

### ✅ Good

```yaml
paths:
  /pets:
    get:
      operationId: listPets
      tags: [pets]
      description: List all pets.
      responses:
        '200':
          description: OK
        default:
          description: Unexpected error
```
