# `paths/params-defined`

Requires every `{param}` placeholder in a path template to have a matching `in: path` parameter definition (merged from both the path-item level and, overriding it by name, the operation level — following normal OpenAPI parameter-inheritance semantics), and conversely flags any `in: path` parameter that doesn't correspond to a placeholder in the template. It also requires every declared path parameter to be `required: true`, since path parameters are structurally always required — a path segment can't be "optional." Left unchecked, a mismatch here means a generated client either can't construct a valid request URL (missing parameter) or exposes a dead/never-used parameter (extra parameter), and a path parameter marked non-required is spec-invalid and will confuse generators about whether the value can be omitted.

**Default severity:** `error`

## Version notes

This rule walks path items with `iteratePathItems(ctx.graph, ctx.entryDoc)` — called **without** a `version` argument, so it only ever visits the root `paths` map, never the 3.1-only `webhooks` map. This is intentional: webhook map keys are arbitrary names (e.g. `newPet`, `"{weird}"`), not URL path templates, so `{param}`-placeholder/parameter matching doesn't apply to them. This is confirmed by `packages/linter/tests/webhooks.test.ts` ("3.1 webhooks: path-shaped rules do NOT apply" / `paths/params-defined ignores webhook keys`). Aside from webhooks being out of scope entirely, there is no other 3.0-vs-3.1 behavior difference.

## Options

No options.

## Examples

### ❌ Bad

```yaml
paths:
  /pets/{id}:
    get:
      operationId: getPet
      tags: [pets]
      description: Get a pet by id.
      responses:
        '200':
          description: OK
```

### ✅ Good

```yaml
paths:
  /pets/{id}:
    get:
      operationId: getPet
      tags: [pets]
      description: Get a pet by id.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OK
```
