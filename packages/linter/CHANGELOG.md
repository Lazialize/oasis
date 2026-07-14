# @oasis/linter

## 0.9.0

### Patch Changes

- [#72](https://github.com/Lazialize/oasis/pull/72) [`73ed5c6`](https://github.com/Lazialize/oasis/commit/73ed5c64dc171a52c12eb6cf1550eafbdc82912f) Thanks [@Lazialize](https://github.com/Lazialize)! - Replace fixed ten-hop reference limits with cycle-aware traversal ([#47](https://github.com/Lazialize/oasis/issues/47)). `resolveMaybeRef` and the
  example validator's schema resolver now follow a `$ref` chain until a concrete target is reached,
  resolution fails, or a Reference Object recurs (a cycle) — a valid acyclic chain of any length
  (including 11+ links and cross-file chains) now resolves instead of being silently treated as
  unresolved. The nested-`allOf` property collector likewise guards against cycles with a visited set
  rather than a hop count.

- [#72](https://github.com/Lazialize/oasis/pull/72) [`d52a1ec`](https://github.com/Lazialize/oasis/commit/d52a1ecef2625796996df0ce06c1a68f032ebe48) Thanks [@Lazialize](https://github.com/Lazialize)! - Three `examples/schema-match` fixes:

  - Count Unicode code points for `minLength`/`maxLength` ([#61](https://github.com/Lazialize/oasis/issues/61)): string length is now measured in
    code points per JSON Schema, not UTF-16 code units, so a supplementary-plane emoji counts as 1
    and `maxLength: 1` accepts it. Diagnostics report the same code-point count.
  - Honor `patternProperties` when validating examples ([#43](https://github.com/Lazialize/oasis/issues/43), 3.1): each example property is matched
    against every `patternProperties` regex and validated against all matching schemas;
    `additionalProperties` applies only when neither `properties` nor `patternProperties` matches.
    Invalid pattern regexes are skipped without crashing. (`unevaluatedProperties` remains
    deliberately unevaluated — see the rule doc.)
  - Keep validation diagnostics attached to the owning document ([#42](https://github.com/Lazialize/oasis/issues/42)): a failure that points at a
    violated schema keyword now carries the schema's own file, so validating an example against a
    schema in another file no longer produces a diagnostic range converted against the wrong
    document.

- [#72](https://github.com/Lazialize/oasis/pull/72) [`ffbd8d1`](https://github.com/Lazialize/oasis/commit/ffbd8d1a10694bdc0874b6863b2819c0af32cab0) Thanks [@Lazialize](https://github.com/Lazialize)! - Classify discriminator mapping values as URI references correctly ([#39](https://github.com/Lazialize/oasis/issues/39)). A mapping value is a bare
  component name (expanded to `#/components/schemas/<name>`) only when it matches
  `^[a-zA-Z0-9._-]+$` and contains neither `/` nor `:`; anything else — a relative path
  (`./dog.yaml`, `../schemas/dog.yaml`), an absolute scheme without `//` (`urn:`), a fragment, or a
  percent-encoded reference — is a URI reference resolved with normal `$ref` semantics.
  `looksLikeMappingRef` in core (shared by reference discovery and the bundler) and the
  `structure/discriminator` / `components/no-unused` rules now agree on this classification, so
  valid relative references are no longer reported unresolved and `urn:`-style values are treated as
  external targets instead of bogus component names.

- [#72](https://github.com/Lazialize/oasis/pull/72) [`ffbd8d1`](https://github.com/Lazialize/oasis/commit/ffbd8d1a10694bdc0874b6863b2819c0af32cab0) Thanks [@Lazialize](https://github.com/Lazialize)! - Count nested component-pointer references as component usage ([#36](https://github.com/Lazialize/oasis/issues/36)). A `$ref` whose target lies
  below a top-level component (e.g. `#/components/schemas/Foo/properties/id`, locally or across
  files) now marks that component (`Foo`) as used, so `components/no-unused` no longer
  false-positives on it and the remove-unused quick fix can't delete a live component.

- [#75](https://github.com/Lazialize/oasis/pull/75) [`94b9305`](https://github.com/Lazialize/oasis/commit/94b9305059cc104ca404f2cd2f23381371c39795) Thanks [@Lazialize](https://github.com/Lazialize)! - Centralize version-aware OpenAPI object shape validation and complete the LSP completion contexts
  ([#65](https://github.com/Lazialize/oasis/issues/65), [#60](https://github.com/Lazialize/oasis/issues/60)).

  - **Linter ([#65](https://github.com/Lazialize/oasis/issues/65)):** a declarative, version-aware object-shape table (`object-shape.ts`) now
    describes every OpenAPI Object — required fields, per-field value types, 3.0 vs 3.1 field
    availability, mutually exclusive field groups, `x-*` extension allowance, and referenceable
    (`$ref`) locations. A new `structure/object-shape` rule validates the metadata objects no other
    rule covered (Info, Contact, License, Tag, External Documentation), preserving each
    diagnostic's source range and owning document. Existing `structure/*` rules and their diagnostics
    are unchanged; the table is exported from `@oasis/linter` as the shared foundation.
  - **Server ([#60](https://github.com/Lazialize/oasis/issues/60)):** completion contexts are driven from that shared table, so suggestions offer only
    the keys legal at the cursor for the document's version. Newly covered: root `webhooks` and
    `jsonSchemaDialect` (3.1), `components.headers`/`examples`/`links`/`callbacks` and 3.1
    `pathItems`, Header/Example/Link/Callback/Encoding/OAuth Flow(s) Objects, and every JSON Schema
    2020-12 applicator (`$defs`, `prefixItems`, `patternProperties`, `if`/`then`/`else`,
    `dependentSchemas`, `unevaluatedProperties`/`unevaluatedItems`, `propertyNames`, `contains`).
    Version-specific fields differ correctly between 3.0 and 3.1 (e.g. `nullable`/`example` vs
    `const`/`examples`/`$defs`; `info.summary`, `license.identifier`).

- [#72](https://github.com/Lazialize/oasis/pull/72) [`c63b61d`](https://github.com/Lazialize/oasis/commit/c63b61de70ce852d8182c0a4ec3ecf6af0a0aad2) Thanks [@Lazialize](https://github.com/Lazialize)! - Traverse every OpenAPI 3.1 JSON Schema applicator consistently ([#40](https://github.com/Lazialize/oasis/issues/40)). The shared schema walker
  (`walkSchemaTree`) is now a single version-aware traversal with complete 3.0 and 3.1 child
  semantics, replacing the previous opt-in flags that let rules miss nested schemas. On 3.1 documents
  it now descends into `patternProperties`, `prefixItems`, `if`/`then`/`else`, `contains`,
  `propertyNames`, `dependentSchemas`, `$defs`, `unevaluatedItems`, `unevaluatedProperties`, and
  `contentSchema` in addition to the previously covered applicators. All schema-inspecting rules
  (`structure/schema-nullable`, `structure/schema-keywords`, `structure/discriminator`,
  `structure/xml`, `style/naming-convention`, `examples/schema-match`) reach every applicable schema
  position — e.g. a forbidden `nullable: true` under `$defs` is now reported.

- [#72](https://github.com/Lazialize/oasis/pull/72) [`af3e6d7`](https://github.com/Lazialize/oasis/commit/af3e6d78df2b1b9495312e9d530f7bb2474247f0) Thanks [@Lazialize](https://github.com/Lazialize)! - Two `security/defined` fixes:

  - Resolve security scheme names in the correct document scope ([#37](https://github.com/Lazialize/oasis/issues/37)): requirement keys are implicit
    component-name references and now resolve only against the entry document's
    `components/securitySchemes` — a same-named scheme in an unrelated referenced file no longer
    makes an undefined requirement appear valid. Diagnostics stay source-ranged to the requirement.
    `components/no-unused` applies the same scope rule to its by-name security scheme exemption.
  - Allow role names for non-OAuth security schemes in OpenAPI 3.1 ([#38](https://github.com/Lazialize/oasis/issues/38)): on 3.0, non-OAuth
    (`apiKey`/`http`/`mutualTLS`) requirement arrays must still be empty; on 3.1 the Security
    Requirement Object explicitly permits role names there, so non-empty arrays are accepted.
    OAuth2 values remain validated as declared scopes on both versions.

- [#67](https://github.com/Lazialize/oasis/pull/67) [`2523da0`](https://github.com/Lazialize/oasis/commit/2523da0f92a7c12fe4e5c322f023b13adcee2531) Thanks [@Lazialize](https://github.com/Lazialize)! - Harden several `structure/*` rules that were silently skipping malformed input instead of reporting it:

  - `structure/schema-keywords` now reports `exclusiveMinimum`/`exclusiveMaximum` values of any non-conforming node kind (object, array, `null`, string, ...), not just the other version's scalar form ([#41](https://github.com/Lazialize/oasis/issues/41))
  - `structure/field-types` and `structure/callbacks` now flag a present but empty Responses Object (`responses: {}`), requiring at least one response code, `default`, or extension (`x-*`) field ([#44](https://github.com/Lazialize/oasis/issues/44))
  - `structure/server-variables` now validates Server Object shape (array item is an object, `url` present and a string, `variables` is an object) at root/Path Item/Operation level instead of silently skipping malformed entries; variable `default`/`enum` checks still run afterward ([#45](https://github.com/Lazialize/oasis/issues/45))
  - `structure/field-types` now validates every Parameter Object consistently, wherever it's legal to appear: `components/parameters`, Path Item and Operation `parameters`, and local/external Reference Objects to any of those (previously only some inline operation-level parameters were checked). Adds required `name`/`in`, `in: path` requiring `required: true`, `schema`/`content` exclusivity, and `style`/`explode`/`allowEmptyValue`/`allowReserved` constraints; `collectParameterObjects` now resolves `components/parameters` entries through the workspace graph like every other components-level collector ([#46](https://github.com/Lazialize/oasis/issues/46))

- [#71](https://github.com/Lazialize/oasis/pull/71) [`1d7a640`](https://github.com/Lazialize/oasis/commit/1d7a6407ebdee9ef25cb5710ef0ede21b752ffa1) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: validate `oasis.config.jsonc` structure before resolving lint configuration ([#33](https://github.com/Lazialize/oasis/issues/33))

  Config files were syntax-checked as JSONC but then cast directly to the config type, so a
  structurally invalid shape (e.g. `"lint": {"overrides": {}}` where an array is expected) crashed
  `resolveConfig` with a TypeError. The complete config shape (`entries`, `lint`, `lint.rules`,
  `lint.overrides` and each override's `files`/`rules`) is now validated at the load boundary:
  invalid fields are dropped and reported as source-ranged `oasis/config` diagnostics (CLI) or
  config warnings (LSP) instead of crashing or being silently coerced.

- Updated dependencies [[`1fd7cbe`](https://github.com/Lazialize/oasis/commit/1fd7cbe435d552d2f9258f438f99d0358c84fb46), [`ffbd8d1`](https://github.com/Lazialize/oasis/commit/ffbd8d1a10694bdc0874b6863b2819c0af32cab0), [`0d0ae66`](https://github.com/Lazialize/oasis/commit/0d0ae66e01e4f65ccb03774bc176019ea43651ad)]:
  - @oasis/core@0.9.0

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
