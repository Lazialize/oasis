# @oasis/linter

## 0.8.4

### Patch Changes

- [#23](https://github.com/Lazialize/oasis/pull/23) [`ec5cd99`](https://github.com/Lazialize/oasis/commit/ec5cd99015e984f2bb20ae5435b2ede90a2ba324) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: linter false-positive and severity-override fixes

  - `examples/schema-match` no longer flags a property as "unexpected" under an `allOf` branch's `additionalProperties: false` when that property is legitimately contributed by a sibling `allOf` branch (e.g. an inherited base schema via `$ref`) — the common inheritance idiom
  - `structure/schema-keywords` no longer reports a `required` entry as unsatisfiable under `additionalProperties: false` when it's actually admitted by a (3.1) `patternProperties` regex
  - a `lint.overrides` entry setting a rule to `"off"` for matching files now silences all of that rule's reports for those files, including ones that pass an explicit severity via `ctx.report(..., { severity })`
  - `structure/field-types` response status code validation is now case-sensitive per spec: `"2xx"`/`"DEFAULT"` are flagged; only `"2XX"`-style uppercase ranges and lowercase `"default"` are accepted

- Updated dependencies [[`8251964`](https://github.com/Lazialize/oasis/commit/8251964082c2e24be03cb2852006b372e9a55153)]:
  - @oasis/core@0.8.4

## 0.8.3

### Patch Changes

- [#20](https://github.com/Lazialize/oasis/pull/20) [`682a8ab`](https://github.com/Lazialize/oasis/commit/682a8ab448d617fe514597c20ca233352ae0a8ee) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: CLI and LSP behavior fixes ahead of 1.0

  - `oasis lint` on an entry file that cannot be loaded now reports an error and exits 1, instead of silently reporting zero diagnostics and exiting 0
  - `oasis lint` now rejects unknown single-dash flags (e.g. `-format`) like `oasis bundle` already did, and both commands accept a `--` separator for entry paths that start with `-`
  - the LSP server clears published diagnostics when a standalone (non-project) document is closed, instead of leaving them in the Problems panel indefinitely

- [#20](https://github.com/Lazialize/oasis/pull/20) [`d600ad9`](https://github.com/Lazialize/oasis/commit/d600ad9a5e36c21bf2e0bcb4aaf828f5a46da707) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: suppression-comment and rule correctness fixes ahead of 1.0

  - `# oasis-disable-*` directives are now extracted from real YAML comment tokens (CST), so directive-looking text inside a block scalar or quoted string no longer silently suppresses diagnostics
  - `structure/field-types` and `structure/callbacks` no longer report `responses` as a missing required field on OpenAPI 3.1 documents (it is optional since 3.1)
  - `security/defined` now also validates scopes: oauth2 scopes must be declared by one of the scheme's flows, and only `oauth2`/`openIdConnect` requirements may list scopes

- Updated dependencies [[`0a04379`](https://github.com/Lazialize/oasis/commit/0a0437902aeffa9b185642dc347841d6ddc993c1), [`aee8902`](https://github.com/Lazialize/oasis/commit/aee8902abe95fd7ed7fc281f2f71989a1bb0eb02), [`d600ad9`](https://github.com/Lazialize/oasis/commit/d600ad9a5e36c21bf2e0bcb4aaf828f5a46da707)]:
  - @oasis/core@0.8.3

## 0.8.2

### Patch Changes

- [#18](https://github.com/Lazialize/oasis/pull/18) [`fcda9cb`](https://github.com/Lazialize/oasis/commit/fcda9cb039ba28624e57914f40001e0e4b364c35) Thanks [@Lazialize](https://github.com/Lazialize)! - Fix several linter rules that missed violations reachable only through a $ref'd path item or a 3.1 `webhooks` map: `structure/http-methods` and `structure/field-types` now resolve path-item `$ref`s and walk `webhooks`(previously they only inspected the entry document's literal`paths`), and `tags/no-unused`no longer reports a tag used only by a webhook operation as unused. Also:`paths/no-duplicates`now normalizes partial-segment path templates (e.g.`/files/report-{id}.json`vs`/files/report-{docId}.json`) instead of only whole-segment ones, and glob matching in `lint.overrides` now normalizes Windows-style path separators before matching against config patterns.

- [#18](https://github.com/Lazialize/oasis/pull/18) [`f5fdd29`](https://github.com/Lazialize/oasis/commit/f5fdd298e78b3604009c2515e47f0416d7f05770) Thanks [@Lazialize](https://github.com/Lazialize)! - Fix two multi-entry-workspace bugs when an `oasis.config.jsonc` declares several `entries` whose graphs share a `$ref`'d file:

  - Rename and find-references now union every loaded graph that contains the target file instead of stopping at the first owning entry. Renaming a component defined in a shared file used to leave sibling entries with a dangling `$ref`, and find-references undercounted; both now cover all reaching graphs and dedupe a file (and its refs) shared by two graphs.
  - `components/no-unused` no longer reports a shared component as unused when only a sibling entry references it. The lint engine's `RuleContext` gained an optional `externalDocuments` field (populated only by the server's project-mode lint path with sibling entries' graph documents) so cross-entry usage counts; a CLI lint of a single entry graph is unchanged. The server's "Remove unused component" quickfix also cross-checks all loaded graphs and won't offer a destructive delete for a component a sibling entry still references.

- [#18](https://github.com/Lazialize/oasis/pull/18) [`efb4404`](https://github.com/Lazialize/oasis/commit/efb4404fc63dd50e1b97e24d12b380888484425b) Thanks [@Lazialize](https://github.com/Lazialize)! - Fix two bugs:

  - `lint.overrides` now applies the overridden rule _options_, not just severity. Previously
    `RuleContext.options` was resolved once from the top-level `lint.rules` entry before a rule ran,
    so a matching override could change a diagnostic's severity but never the options a rule actually
    checked against. `RuleContext` gained `optionsFor(filePath)` to resolve options per matched file
    (the same override resolution `report()` already used for severity); `style/naming-convention`
    (the only rule that takes options today) now uses it, so e.g. an `operationId` casing override for
    a glob of files is honored instead of silently falling back to the top-level casing style.
  - The LSP server now re-validates open standalone entries when an open `$ref`'d fragment file with
    no top-level `openapi:` key is edited. Previously such a fragment routed as `{kind: "ignored"}` on
    edit; its graph cache was invalidated correctly, but nothing re-validated the dependent standalone
    entry, so its published diagnostics went stale until the entry document itself was next edited.

- Updated dependencies [[`8060414`](https://github.com/Lazialize/oasis/commit/8060414c1f890f599b820dfe93c8c9f94c5b1435), [`bb3a169`](https://github.com/Lazialize/oasis/commit/bb3a169ad6345fa0763b438c6e63341b62cc09d9)]:
  - @oasis/core@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @oasis/core@0.8.1

## 0.8.0

### Minor Changes

- [#14](https://github.com/Lazialize/oasis/pull/14) [`e7bc9c4`](https://github.com/Lazialize/oasis/commit/e7bc9c42099913a43a3449162f3ded39fadba011) Thanks [@Lazialize](https://github.com/Lazialize)! - Breaking changes taken during the pre-1.0 "last window" (see ROADMAP.md's "Definition of 1.0":
  rule names and diagnostic output are frozen at 1.0). If you're pinned to a specific version, read
  this before upgrading:

  - **Severity token**: emitted diagnostics now carry `"warn"` instead of `"warning"` (JSON output,
    pretty output, and the LSP's internal severity mapping). Config already used `"warn"` — this
    only affects code that reads the _emitted_ severity string (e.g. `--format json` consumers).
    SARIF `level` is unaffected (`"warning"` is fixed by the SARIF spec).
  - **Rule renames**: most non-`structure/*` built-in rules are now namespaced, matching
    `structure/*`'s existing `<namespace>/<leaf>` shape. There are no aliases — old names in
    `oasis.config.jsonc` or `# oasis-disable-*` comments now produce an "unknown rule" config
    warning instead of applying. Update any config, suppression comments, or tooling that references
    a rule by name:

    | Old name                     | New name                     |
    | ---------------------------- | ---------------------------- |
    | `no-duplicate-keys`          | `syntax/no-duplicate-keys`   |
    | `no-unresolved-ref`          | `refs/no-unresolved`         |
    | `no-ref-cycle`               | `refs/no-cycle`              |
    | `operation-operationId`      | `operation/operation-id`     |
    | `operation-tags`             | `operation/tags`             |
    | `operation-description`      | `operation/description`      |
    | `operation-success-response` | `operation/success-response` |
    | `path-params-defined`        | `paths/params-defined`       |
    | `no-duplicate-paths`         | `paths/no-duplicates`        |
    | `no-unused-components`       | `components/no-unused`       |
    | `security-defined`           | `security/defined`           |
    | `tags-defined`               | `tags/defined`               |
    | `no-unused-tags`             | `tags/no-unused`             |
    | `naming-convention`          | `style/naming-convention`    |
    | `example-schema-match`       | `examples/schema-match`      |

  - **`oasis/config`**: diagnostics about the configuration or invocation itself (an unknown rule
    name, a declared `entries` path that doesn't exist, …) now use the reserved rule id
    `"oasis/config"` instead of `"config"`. It isn't a real rule — it can't be configured or
    suppressed.
  - **JSON output `file` path**: `oasis lint --format json` now emits `file` relative to
    `process.cwd()` (forward-slashed) when the diagnostic's file is inside the working directory,
    falling back to an absolute path otherwise — matching the existing SARIF `--format sarif`
    behavior. Previously this was always an absolute path. Pretty output (the default) changed the
    same way for consistency.

  Additive, non-breaking in this same release:

  - `oasis lint --help`/`-h` and `oasis bundle --help`/`-h` now print per-command usage and exit 0
    instead of failing with "Unknown flag".
  - Pretty output's summary line now includes the info count alongside errors/warnings.

### Patch Changes

- Updated dependencies [[`e7bc9c4`](https://github.com/Lazialize/oasis/commit/e7bc9c42099913a43a3449162f3ded39fadba011)]:
  - @oasis/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - @oasis/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies []:
  - @oasis/core@0.6.0

## 0.5.0

### Minor Changes

- [#8](https://github.com/Lazialize/oasis/pull/8) [`602a03c`](https://github.com/Lazialize/oasis/commit/602a03c8d6cd614237965523dde2b155dc4b6a1c) Thanks [@Lazialize](https://github.com/Lazialize)! - New `oasis init` command scaffolds an `oasis.config.jsonc` in the current directory: it scans up
  to 2 levels deep (skipping `node_modules` and hidden directories) for YAML/JSON files whose root
  has an `openapi:` key and pre-fills `entries` with what it finds, refusing to overwrite an
  existing config (exit `2`).

  Config `entries` may now be glob patterns (`"entries": ["apis/**/openapi.yaml"]`), expanded
  relative to the config file's directory. Symlinked directories are not followed, hidden
  directories and `node_modules` never match, and files matched by more than one entry are deduped.
  A glob matching no files gets the same warning-diagnostic treatment as a missing literal entry.
  Applies to both `oasis lint` (no-arg mode) and LSP project mode, which re-expands globs on config
  reload.

- [#8](https://github.com/Lazialize/oasis/pull/8) [`9da0fe7`](https://github.com/Lazialize/oasis/commit/9da0fe7dae5d9b5c4a46b51a3eca91872665e18f) Thanks [@Lazialize](https://github.com/Lazialize)! - `no-unused-components` now counts name-based references, not just `$ref`: a security scheme
  named in any `security` requirement (root, operation, or 3.1 webhook operation) is treated as
  used, and a `discriminator.mapping` value (either the `#/components/schemas/X` pointer form or
  the bare-name shorthand) marks the target schema as used. This removes false positives for
  components that were only ever referenced by name.

### Patch Changes

- [#8](https://github.com/Lazialize/oasis/pull/8) [`8175852`](https://github.com/Lazialize/oasis/commit/8175852fc9fa327e685f2254d11afacbb844e48f) Thanks [@Lazialize](https://github.com/Lazialize)! - Lint performance: memoize `$ref` scanning and the `paths`/`webhooks`/`components` traversal
  helpers (`iteratePathItems`, `iterateOperations`, `iterateSchemas`, `iterateMediaTypes`) so
  repeated calls from independent rules within a single `lint()` run reuse work instead of
  re-walking the whole document graph each time; also cache YAML map key lookups so resolving a
  `$ref` into a large `components/schemas` map is no longer a linear scan per lookup. No behavior
  change — output is identical, just faster on large/multi-file specs.
- Updated dependencies [[`8175852`](https://github.com/Lazialize/oasis/commit/8175852fc9fa327e685f2254d11afacbb844e48f)]:
  - @oasis/core@0.5.0

## 0.4.0

### Minor Changes

- [#6](https://github.com/Lazialize/oasis/pull/6) [`e5667b7`](https://github.com/Lazialize/oasis/commit/e5667b76d865caa63b7d1767c14c1780d1d9844b) Thanks [@Lazialize](https://github.com/Lazialize)! - Three new `structure/*` rules cover more of the OpenAPI object model: `structure/discriminator`
  (Discriminator Object: required `propertyName`, `mapping` targets resolve in-workspace, a
  discriminator requires `oneOf`/`anyOf`/`allOf` on the same schema, and `propertyName` must be a
  property of — and, in OpenAPI 3.0, required by — each resolvable `oneOf`/`anyOf` branch schema),
  `structure/callbacks` (Callback Object: expression keys look like runtime expressions or URLs,
  mapped Path Item Objects have valid keys, and their operations declare `responses`), and
  `structure/links` (Link Object: exactly one of `operationRef`/`operationId` is set, `operationId`
  matches an operationId in the workspace, and local `#/paths/...`/`#/webhooks/...` `operationRef`
  pointers resolve). All default to `error` severity.

- [#6](https://github.com/Lazialize/oasis/pull/6) [`06f9367`](https://github.com/Lazialize/oasis/commit/06f9367ceb75f747fdb4e11f21adb70c5077c104) Thanks [@Lazialize](https://github.com/Lazialize)! - New `structure/schema-keywords` rule validates Schema Object keywords against the document's
  dialect: JSON Schema 2020-12 keywords only valid in OpenAPI 3.1 (`const`, `prefixItems`,
  `contentMediaType`, `contentEncoding`, `patternProperties`, `propertyNames`,
  `unevaluatedProperties`, `unevaluatedItems`, `dependentRequired`, `dependentSchemas`,
  `if`/`then`/`else`, `$defs`, `examples`) are flagged on 3.0, and `exclusiveMinimum`/
  `exclusiveMaximum` must be boolean on 3.0 vs numeric on 3.1. It also checks value types (`type`,
  numeric bounds, `pattern`, `required`, `enum`, `items`, `properties`, `additionalProperties`,
  `format`), internal consistency (min/max contradictions, `required` properties excluded by
  `additionalProperties: false`), and `$ref` sibling keys (ignored — and flagged — in 3.0, legal in
  3.1). Defaults to `error` severity. `nullable` and 3.0 `type` array/`null` handling remain the
  responsibility of the existing `structure/schema-nullable` rule to avoid double-reporting.

- [#6](https://github.com/Lazialize/oasis/pull/6) [`e5715fa`](https://github.com/Lazialize/oasis/commit/e5715fa7c5233ab6270dab7466bcf5271d5fffc4) Thanks [@Lazialize](https://github.com/Lazialize)! - Five new `structure/*` rules extend structural validation to object types the linter didn't
  previously check: `structure/security-schemes` (Security Scheme Object: valid `type` and
  per-type required fields, including 3.1's `mutualTLS`), `structure/server-variables` (Server
  Object `variables` agree with `{var}` templates in `url`), `structure/encoding` (Media Type
  Object `encoding` keys and field shapes), `structure/xml` (Schema Object `xml` field), and
  `structure/examples` (Example Object `value`/`externalValue` exclusivity and allowed keys, in
  both `components/examples` and inline `examples` maps). All default to `error` severity except
  the unused-server-variable diagnostic, which is a `warn`.

- [#6](https://github.com/Lazialize/oasis/pull/6) [`3dd4215`](https://github.com/Lazialize/oasis/commit/3dd4215685da82dff206aa2905014af5aa5405e5) Thanks [@Lazialize](https://github.com/Lazialize)! - Broader lint traversal: operation-level rules (`operation-*`, `security-defined`, `tags-defined`,
  `naming-convention`, `example-schema-match`) now also cover operations under the root `webhooks`
  map on 3.1 documents (`operationId` uniqueness spans paths and webhooks; `no-unused-components`
  counts webhook `$ref`s). Path-shaped rules (`path-params-defined`, `no-duplicate-paths`) stay
  `paths`-only since webhook keys are arbitrary names, not URL templates. Schema rules
  (`structure/schema-nullable`, `naming-convention` property names, `example-schema-match`) now
  check every schema site — inline request/response media-type, parameter and header schemas
  (operation- and components-level) in addition to `components/schemas` — via a shared walker that
  resolves `$ref`s through the workspace and visits each shared schema once.

### Patch Changes

- Updated dependencies []:
  - @oasis/core@0.4.0

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
