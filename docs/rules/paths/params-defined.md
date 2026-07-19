# `paths/params-defined`

Requires every `{param}` placeholder in a path template to have a matching `in: path` parameter definition (merged from both the path-item level and, overriding it by name, the operation level — following normal OpenAPI parameter-inheritance semantics), and conversely flags any `in: path` parameter that doesn't correspond to a placeholder in the template. It also requires every declared path parameter to be `required: true`, since path parameters are structurally always required — a path segment can't be "optional." Left unchecked, a mismatch here means a generated client either can't construct a valid request URL (missing parameter) or exposes a dead/never-used parameter (extra parameter), and a path parameter marked non-required is spec-invalid and will confuse generators about whether the value can be omitted.

**Default severity:** `error`

## Version notes

This rule only visits the root `paths` map, never the 3.1/3.2 `webhooks` map. Webhook keys are arbitrary names, not URL path templates, so `{param}` placeholder matching does not apply. Other behavior is version-independent.

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
