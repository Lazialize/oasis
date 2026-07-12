# @oasis/linter

## 0.3.0

### Minor Changes

- [#4](https://github.com/Lazialize/oasis/pull/4) [`01eea54`](https://github.com/Lazialize/oasis/commit/01eea5490e1ec876513beabc6616ac8cd82f34ad) Thanks [@Lazialize](https://github.com/Lazialize)! - New `example-schema-match` rule (default: warn): validates that `example` / `examples[].value`
  values conform to their schema — on Schema Objects, Media Type Objects, and Parameter Objects,
  resolving `$ref`s across the workspace. Version-aware: 3.0 `nullable` and boolean exclusive
  bounds vs 3.1 type arrays, `"null"` type, `const`, `prefixItems`, and numeric exclusive bounds.
  Validation is a deliberate hand-rolled subset (no JSON Schema validator dependency); schemas
  using `not`, `discriminator`, or unresolved `$ref`s are skipped rather than risk false positives.

- [#4](https://github.com/Lazialize/oasis/pull/4) [`d09740e`](https://github.com/Lazialize/oasis/commit/d09740e2f04b42bdb3951a4f4382af2516fab231) Thanks [@Lazialize](https://github.com/Lazialize)! - Five new built-in lint rules: `operation-success-response` (warn — every operation has a 2xx/3xx
  response), `no-duplicate-paths` (error — path templates that are equivalent up to parameter names,
  e.g. `/users/{id}` vs `/users/{userId}`), `security-defined` (error — every scheme name referenced
  in a `security` requirement exists in `components/securitySchemes`), `tags-defined` (off by
  default — operation tags are declared in the root `tags` list), and `no-unused-tags` (warn — root
  `tags` entries are used by at least one operation).

- [#4](https://github.com/Lazialize/oasis/pull/4) [`30f8d97`](https://github.com/Lazialize/oasis/commit/30f8d97429d7cd5d0bd2537aed2a8344a3388a1b) Thanks [@Lazialize](https://github.com/Lazialize)! - Inline lint suppression via YAML comments: `# oasis-disable-next-line <rule...>` suppresses the
  listed rules (or all, with no names) for diagnostics on the following line, and
  `# oasis-disable-file <rule...>` does the same for the whole file. Suppression is resolved
  per-file, so a directive in a file reached only via `$ref` only affects diagnostics attributed to
  that file, and it flows through the shared lint engine so `oasis lint` and the LSP server honor it
  identically. Syntax errors are never suppressible. JSON documents don't support comments, so this
  is YAML-only; `@oasis/core` gains `extractSuppressions`/`isSuppressed` to support it.

- [#4](https://github.com/Lazialize/oasis/pull/4) [`974beec`](https://github.com/Lazialize/oasis/commit/974beeca579c7813fa5bd1de36fa8ba440e527f6) Thanks [@Lazialize](https://github.com/Lazialize)! - Add the `naming-convention` lint rule: configurable casing checks for operationIds, component
  names (`components/*`, including 3.1 `pathItems`), parameter names (skipping `in: header`), and
  schema property names. Off by default and a no-op until configured with an options object, e.g.
  `"naming-convention": ["warn", { "operationId": "camelCase", "componentName": "PascalCase" }]`.
  This is the first built-in rule to consume the rule-options plumbing added previously.

- [#4](https://github.com/Lazialize/oasis/pull/4) [`e0f9ed3`](https://github.com/Lazialize/oasis/commit/e0f9ed329249dc48ed49068b99ad66d279daa645) Thanks [@Lazialize](https://github.com/Lazialize)! - Lint config: rules can now take an options object (`"rule-name": ["error", { ...options }]`
  alongside the existing plain-severity form), and `lint.overrides` applies rule config to files
  matching a glob (matched relative to the config file's directory, including files reached only via
  `$ref`). Both are plumbed through the shared engine, so `oasis lint` and the LSP server pick them
  up the same way. No built-in rule consumes options yet.

### Patch Changes

- Updated dependencies [[`30f8d97`](https://github.com/Lazialize/oasis/commit/30f8d97429d7cd5d0bd2537aed2a8344a3388a1b)]:
  - @oasis/core@0.3.0

## 0.2.0

### Minor Changes

- [`be64699`](https://github.com/Lazialize/oasis/commit/be646998f95fbe713d9c2edeeab1b3ba05105da5) Thanks [@Lazialize](https://github.com/Lazialize)! - Initial release: OpenAPI linter with position-preserving diagnostics, multi-file bundler, language server (LSP), and the `oasis` CLI. Includes the companion VS Code extension.

### Patch Changes

- Updated dependencies [[`be64699`](https://github.com/Lazialize/oasis/commit/be646998f95fbe713d9c2edeeab1b3ba05105da5)]:
  - @oasis/core@0.2.0
