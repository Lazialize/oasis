# `tags/defined`

Requires every tag used in an operation's `tags` list to be declared in the document's root `tags` list. Operations can reference tag names freely without ever declaring them at the root, since the root `tags` array is technically optional metadata (mostly used to control ordering and add descriptions in generated docs). This rule makes tag usage disciplined: any tag an operation reaches for must have a corresponding root-level declaration, catching typos and forgotten registrations before they show up as an orphaned tag in generated documentation.

**Default severity:** `off`

## Version notes

Operations are walked via the shared operation iterator, which on 3.1 documents includes operations declared under the root `webhooks` map in addition to `paths` — a webhook operation's tag is checked the same way a regular path operation's is. There is no other version-specific behavior.

## Options

No options.

## Examples

### ❌ Bad

```yaml
tags:
  - name: pets
paths:
  /pets:
    get:
      operationId: listPets
      tags: [reptiles]
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
      tags: [reptiles]
      responses:
        '200':
          description: OK
```
