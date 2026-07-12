# `structure/links`

This rule checks every Link Object — under a Response Object's `links` and under `components/links`, resolving `$ref`s and deduplicating by resolved location — for structural correctness: only the known keys `operationRef`, `operationId`, `parameters`, `requestBody`, `description`, `server` (plus `x-` extensions) are allowed; exactly one of `operationRef` or `operationId` must be set (never both, never neither); `operationId`, when used, must be a string that matches an `operationId` declared somewhere in the workspace; and `operationRef`, when used and it's a local pointer into `#/paths/...` (or, on 3.1, `#/webhooks/...`), must resolve to something in the workspace graph (other `operationRef` forms, like external URLs or refs into other document sections, are left unchecked). A Link that points at an `operationId` that doesn't exist, or both/neither of the two link-target fields, is not usable by any tool that tries to follow it (e.g. to build an interactive "try it" flow), and this class of mistake is easy to introduce when operations get renamed or removed.

**Default severity:** `error`

## Version notes

The `operationRef` local-pointer resolution recognizes `#/webhooks/...` targets in addition to `#/paths/...` on OpenAPI 3.1 documents, since `webhooks` is a 3.1-only top-level section; on 3.0 documents only `#/paths/...` pointers are resolved this way. All other checks (mutually-exclusive `operationRef`/`operationId`, `operationId` matching, allowed keys) apply identically to both versions.

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
```

Reports `... link "BothSet" must not set both "operationRef" and "operationId".`, `... link "NeitherSet" must set exactly one of "operationRef" or "operationId".`, `... link "UnknownOp" "operationId" "doesNotExist" does not match any operationId in the workspace.`, and `... link "BadRef" "operationRef" "#/paths/~1missing/get" does not resolve in the workspace.`

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
