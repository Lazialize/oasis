# `operation/operation-id`

Requires every operation to declare a non-empty `operationId`, and requires every `operationId` to be unique across the whole workspace (all documents reachable from the entry file, not just the current one). This matters because client and server code generators use `operationId` as the method/function name for each operation — a missing id forces generators to fall back to auto-generated, unstable names, and a duplicate id causes a collision (two operations mapping to the same generated method, silently overwriting one of them, or a generator hard error).

**Default severity:** `error`

## Version notes

This rule walks operations via `iterateOperations`, which on a 3.1 document also includes every operation under the root `webhooks` map (in addition to `paths`). So a webhook operation's `operationId` is checked for presence and must be unique across both `paths` and `webhooks` — a `paths` operation and a `webhooks` operation with the same `operationId` are flagged as duplicates of each other. On a 3.0 document, `webhooks` is not a spec-defined key and is not walked at all. Aside from this operation-enumeration difference, the check itself (presence + uniqueness) is identical between 3.0 and 3.1.

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
      responses:
        '200':
          description: OK
  /pets/{id}:
    get:
      operationId: listPets
      tags: [pets]
      responses:
        '200':
          description: OK
```

### ✅ Good

```yaml
paths:
  /pets:
    get:
      operationId: listPets
      tags: [pets]
      responses:
        '200':
          description: OK
  /pets/{id}:
    get:
      operationId: getPetById
      tags: [pets]
      responses:
        '200':
          description: OK
```
