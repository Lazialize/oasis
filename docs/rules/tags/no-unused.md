# `tags/no-unused`

Requires every tag declared in the document's root `tags` list to be used by at least one operation's `tags` array. A tag that's declared but never applied to any operation is dead documentation metadata: it shows up as an empty group in generated API docs (Swagger UI, Redoc, etc.) with nothing under it, which is confusing for readers and usually means the tag was renamed, removed from operations, or never actually wired up.

**Default severity:** `warn`

## Version notes

Tag usage is collected by walking operations via the shared operation iterator. Note that unlike some of the other rules in this set, this collection call does not pass an explicit `version` argument, so it defaults to walking `paths` operations only — 3.1 `webhooks` operations are not consulted when determining whether a declared tag is "used." A tag used only by a webhook operation's `tags` list would therefore still be flagged as unused on a 3.1 document. This is a genuine gap worth confirming with the maintainers before treating it as settled behavior (flagged below).

## Options

No options.

## Examples

### ❌ Bad

```yaml
tags:
  - name: pets
  - name: reptiles
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
paths:
  /pets:
    get:
      operationId: listPets
      tags: [pets]
      responses:
        '200':
          description: OK
```
