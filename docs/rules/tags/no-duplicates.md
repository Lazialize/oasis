# `tags/no-duplicates`

Requires every Tag Object in the document's root `tags` list to have a unique `name`. The OpenAPI specification mandates that each tag name in the root `tags` array be unique; duplicated declarations are ambiguous — generated docs don't know which `description` or `externalDocs` to show for the group, and a rename applied to only one occurrence silently splits the tag's metadata. The rule reports the second and any subsequent occurrences of a name, pointing at the duplicate `name` value, while the first declaration is left untouched as the canonical one.

**Default severity:** `error`

## Version notes

The root `tags` list has the same shape and uniqueness requirement on 3.0 and 3.1 documents. There is no version-specific behavior.

## Options

No options.

## Examples

### ❌ Bad

```yaml
tags:
  - name: pets
  - name: pets
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
tags:
  - name: pets
  - name: reptiles
paths:
  /pets:
    get:
      operationId: listPets
      tags: [pets, reptiles]
      responses:
        '200':
          description: OK
```
