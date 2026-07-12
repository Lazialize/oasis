# `syntax/no-duplicate-keys`

Flags duplicate keys within a single YAML/JSON mapping (e.g. `title` declared twice under `info`). This rule doesn't run its own detection; it surfaces `no-duplicate-keys` diagnostics that `@oasis/core` already records while parsing each document. YAML parsers are permitted to silently keep only the last occurrence of a duplicate key and discard the earlier one — which means a duplicate key is a silent, easy-to-miss authoring mistake where a value you think is in the document has actually been overwritten and dropped.

**Default severity:** `error`

## Version notes

Duplicate-key detection is a purely syntactic, structural walk over every mapping in a parsed document (`@oasis/core`'s `detectDuplicateKeys`) — it happens before any OpenAPI-specific interpretation and does not distinguish `paths` from `webhooks`, or 3.0 from 3.1 in any way. This rule itself has no version-specific branching: it iterates `ctx.documents` and relays whatever `no-duplicate-keys` diagnostics already exist on each document, unconditionally. Unlike raw unrecoverable YAML parse failures (which the linter engine reports under a separate, always-`error`, non-configurable `syntax-error` rule), `syntax/no-duplicate-keys` is a normal, configurable rule — its severity can be overridden or disabled via lint config like any other rule in this reference.

## Options

No options.

## Examples

### ❌ Bad

```yaml
openapi: 3.0.3
info:
  title: T
  version: "1.0.0"
  title: Dup
paths: {}
```

### ✅ Good

```yaml
openapi: 3.0.3
info:
  title: T
  version: "1.0.0"
paths: {}
```
