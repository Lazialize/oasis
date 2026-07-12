# `refs/no-unresolved`

Flags every `$ref` value that cannot be resolved to an actual target, covering two distinct failure modes: the referenced file couldn't be loaded at all (missing file, or a file that failed to load — already recorded when the workspace graph was built), and a pointer that doesn't exist within an otherwise-successfully-loaded document (e.g. `#/components/schemas/Missing` when no such schema is defined). Either way, a `$ref` that doesn't resolve is a broken link: bundlers can't inline it, code generators can't produce a type for it, and IDE "go to definition" has nowhere to go. This rule surfaces both cases uniformly by re-resolving every `$ref` found anywhere in every loaded document via `findRefs`/`resolveRef`.

**Default severity:** `error`

## Version notes

This rule iterates `ctx.documents` and calls `findRefs`/`resolveRef` on each — a purely structural, version-agnostic walk over every `$ref` in the workspace (it does not use `iterateOperations`/`iteratePathItems`, so it isn't gated by OpenAPI version at all). It applies identically to 3.0 and 3.1 documents, including `$ref`s inside a 3.1 `webhooks` map, since it doesn't distinguish where a `$ref` appears — only whether it resolves.

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
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Missing'
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
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
components:
  schemas:
    Pet:
      type: object
      properties:
        id:
          type: string
```
