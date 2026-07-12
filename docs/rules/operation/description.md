# `operation/description`

Requires every operation to have a non-empty `description` or `summary` (either one satisfies the rule; both being blank/whitespace-only fails it). Operations without any human-readable explanation produce unusable generated API reference docs and force API consumers to reverse-engineer intent from the path, method, and schema alone — this rule exists to catch operations that were stubbed out during authoring and never got a real description.

**Default severity:** `warn`

## Version notes

Operations are enumerated with `iterateOperations`, which on a 3.1 document also walks the root `webhooks` map in addition to `paths`, so webhook operations are held to the same description/summary requirement. On a 3.0 document there is no `webhooks` map to walk, so only `paths` operations are checked. The description/summary check itself is otherwise identical between versions.

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
```

### ✅ Good

```yaml
paths:
  /pets:
    get:
      operationId: listPets
      tags: [pets]
      description: List all pets in the store.
      responses:
        '200':
          description: OK
```
