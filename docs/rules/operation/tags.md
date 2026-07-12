# `operation/tags`

Requires every operation to declare a `tags` array with at least one non-empty tag value. Tags are the primary grouping mechanism used by documentation tools (Redoc, Swagger UI) and SDK generators to organize operations into sections/namespaces; an untagged operation either gets dumped into an "Uncategorized" bucket in generated docs or, in stricter generators, produces an ungrouped/oddly-named client method. This rule catches both a missing `tags` array entirely and a `tags` array that only contains empty strings.

**Default severity:** `warn`

## Version notes

Operations are enumerated with `iterateOperations`, which on a 3.1 document also includes operations under the root `webhooks` map, not just `paths`. A webhook operation with no tags (or only empty-string tags) is flagged the same way as a `paths` operation. On a 3.0 document there is no `webhooks` key to walk, so only `paths` operations are checked. The tag-presence/non-empty check itself does not otherwise differ between versions.

## Options

No options.

## Examples

### ❌ Bad

```yaml
paths:
  /pets:
    get:
      operationId: listPets
      description: List all pets.
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
      description: List all pets.
      responses:
        '200':
          description: OK
```
