# `structure/links`

This rule checks every Link Object — under a Response Object's `links` and under `components/links`, resolving `$ref`s and deduplicating by resolved location — for structural correctness: only the known keys `operationRef`, `operationId`, `parameters`, `requestBody`, `description`, `server` (plus `x-` extensions) are allowed; exactly one of `operationRef` or `operationId` must be set (never both, never neither); `operationId`, when used, must be a string that matches an `operationId` declared somewhere in the workspace; and `operationRef`, when used, must resolve in the workspace graph to an actual Operation Object — an HTTP-method child of a Path Item under `paths` (or, on 3.1, `webhooks`). A pointer that's missing, or that resolves to something other than an Operation Object (a Schema Object, a Path Item Object, an arbitrary property that merely looks like an HTTP method, etc.), is reported. An `operationRef` targeting an external URI (`https:`, `urn:`, a scheme-relative `//host/…` URL) points outside the workspace and cannot be verified locally, so it is left unchecked — the spec explicitly allows referencing operations in external documents. A Link that points at an `operationId` that doesn't exist, or at a non-Operation target, or sets both/neither of the two link-target fields, is not usable by any tool that tries to follow it (e.g. to build an interactive "try it" flow), and this class of mistake is easy to introduce when operations get renamed, removed, or the wrong section is referenced.

**Default severity:** `error`

## Version notes

`operationRef` targets under `#/webhooks/...` are valid Operation Objects on OpenAPI 3.1/3.2 documents; on 3.0 they are rejected. OpenAPI 3.2 operation lookup also recognizes `query` and entries under `additionalOperations`.

## Options

No options.

## Examples

### ❌ Bad

```yaml
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
          links:
            BothSet:
              operationId: listPets
              operationRef: '#/paths/~1pets/get'
            NeitherSet:
              description: no op ref or id
            UnknownOp:
              operationId: doesNotExist
            BadRef:
              operationRef: '#/paths/~1missing/get'
            SchemaRef:
              operationRef: '#/components/schemas/Pet'
components:
  schemas:
    Pet:
      type: object
```

Reports `... link "BothSet" must not set both "operationRef" and "operationId".`, `... link "NeitherSet" must set exactly one of "operationRef" or "operationId".`, `... link "UnknownOp" "operationId" "doesNotExist" does not match any operationId in the workspace.`, `... link "BadRef" "operationRef" "#/paths/~1missing/get" does not resolve in the workspace.`, and `... link "SchemaRef" "operationRef" "#/components/schemas/Pet" must resolve to an Operation Object.`

### ✅ Good

```yaml
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
          links:
            GetPet:
              operationId: listPets
```
