# `paths/no-duplicates`

Flags path templates that are equivalent once parameter names are stripped out — e.g. `/users/{id}` and `/users/{userId}` both normalize to `/users/{}` and are reported as conflicting, even though they're spelled differently. Two path templates that only differ by parameter name are indistinguishable at request-routing time (an incoming URL like `/users/123` could match either), so a server built from this spec would have ambiguous, non-deterministic routing, and generated clients would end up with two near-identical methods for what is really the same underlying route.

**Default severity:** `error`

## Version notes

This rule walks path items with `iteratePathItems(ctx.graph, ctx.entryDoc)` — called **without** a `version` argument, so it only ever visits the root `paths` map and never the 3.1-only `webhooks` map. Webhook keys are arbitrary event names, not URL templates, so template-shape comparison doesn't make sense for them; `packages/linter/tests/webhooks.test.ts` ("3.1 webhooks: path-shaped rules do NOT apply" / `paths/no-duplicates ignores webhooks entirely`) confirms webhooks never participate in this check. Other than webhooks being entirely out of scope, there is no 3.0-vs-3.1 behavior difference — normalization and comparison work the same way on both.

## Options

No options.

## Examples

### ❌ Bad

```yaml
paths:
  /users/{id}:
    get:
      operationId: getUserById
      tags: [users]
      description: Get a user by id.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OK
  /users/{userId}:
    get:
      operationId: getUserByUserId
      tags: [users]
      description: Get a user by id, again.
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OK
```

### ✅ Good

```yaml
paths:
  /users/{id}:
    get:
      operationId: getUserById
      tags: [users]
      description: Get a user by id.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OK
  /users/{id}/orders:
    get:
      operationId: listUserOrders
      tags: [users]
      description: List a user's orders.
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
