# @oasis/server

## 0.9.0

### Patch Changes

- [#73](https://github.com/Lazialize/oasis/pull/73) [`f963901`](https://github.com/Lazialize/oasis/commit/f96390109865155ec0627b47314141e19ffa3221) Thanks [@Lazialize](https://github.com/Lazialize)! - LSP server handler fixes and improvements:

  - Rename validates new component names against the component-key grammar (`^[A-Za-z0-9._-]+$`) and
    returns a rename error instead of writing a partial, YAML-corrupting edit; replacement text is
    encoded for its syntactic context (JSON keys double-quoted, YAML keys quoted when they would be
    reinterpreted).
  - Find References and Rename now count `$ref`s that resolve to nested pointers under a component
    (e.g. `#/components/schemas/Foo/properties/id`); rename replaces only the component-name segment
    and preserves the suffix.
  - Rename, Find References, and prepareRename share one semantic reference index that includes
    name-based OpenAPI references: Security Requirement Object keys (root and operation scope) and
    discriminator `mapping` values (bare-name form preserved, URI form edited as a pointer segment).
  - Inline/extract code actions rebase internal references when they move a subtree across documents
    (same-document and file-relative refs are re-relativized; absolute URIs left unchanged), and are
    suppressed when relocation cannot be made safe (YAML anchors/aliases, `$id`/`$anchor` scopes,
    plain-name anchor fragments, `file:` URIs).
  - The add-missing-path-parameter quick fix replaces an inline empty `parameters: []` with a valid
    block sequence instead of producing malformed YAML.
  - Document symbols include OpenAPI 3.1 root-level `webhooks` (with operation children); 3.0
    documents are unchanged.
  - Document links classify `$ref` values per RFC 3986: absolute non-filesystem URIs without a `//`
    authority (e.g. `urn:example:schema`) are no longer exposed as clickable local file links.

- [#75](https://github.com/Lazialize/oasis/pull/75) [`83e68e5`](https://github.com/Lazialize/oasis/commit/83e68e5c98b9544857f2d658977b56e772757071) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: LSP server lifecycle and diagnostics-flow bug fixes (with matching VS Code extension updates, released via the synced extension version)

  - diagnostics for a file shared by multiple project entries are now stored per entry and published as the merged, deduplicated union, so one entry's results no longer clobber another's and unloading an entry removes only its own contribution ([#48](https://github.com/Lazialize/oasis/issues/48))
  - stale asynchronous validations are discarded: a lint run superseded by a newer edit, a project reload, or a document close can no longer finish late and overwrite newer diagnostics or poison the workspace-graph cache ([#49](https://github.com/Lazialize/oasis/issues/49))
  - closing a document now revalidates project state from disk: an unsaved project-member buffer's diagnostics are recomputed from the file on disk, and closing an edited `oasis.config.jsonc` reloads the on-disk project configuration ([#50](https://github.com/Lazialize/oasis/issues/50))
  - external (on-disk) changes to closed project files — git checkout, codegen, another process — now refresh diagnostics: the VS Code extension watches workspace YAML/JSON files and the server invalidates and revalidates affected entry graphs, re-expanding glob entries on create/delete, while never replacing an open unsaved buffer with disk content ([#51](https://github.com/Lazialize/oasis/issues/51))
  - the lightweight "looks like OpenAPI" guard (server and VS Code extension) now only matches an `openapi` key at the document root, so files with a nested `openapi` property are no longer wrongly synchronized and linted ([#52](https://github.com/Lazialize/oasis/issues/52))
  - the VS Code extension resynchronizes already-open documents whenever project mode toggles: fragment files gain a synthetic `didOpen` when a config appears, and non-OpenAPI documents are closed on the server when the last config disappears ([#58](https://github.com/Lazialize/oasis/issues/58))

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

- Updated dependencies [[`1fd7cbe`](https://github.com/Lazialize/oasis/commit/1fd7cbe435d552d2f9258f438f99d0358c84fb46), [`73ed5c6`](https://github.com/Lazialize/oasis/commit/73ed5c64dc171a52c12eb6cf1550eafbdc82912f), [`d52a1ec`](https://github.com/Lazialize/oasis/commit/d52a1ecef2625796996df0ce06c1a68f032ebe48), [`ffbd8d1`](https://github.com/Lazialize/oasis/commit/ffbd8d1a10694bdc0874b6863b2819c0af32cab0), [`ffbd8d1`](https://github.com/Lazialize/oasis/commit/ffbd8d1a10694bdc0874b6863b2819c0af32cab0), [`94b9305`](https://github.com/Lazialize/oasis/commit/94b9305059cc104ca404f2cd2f23381371c39795), [`c63b61d`](https://github.com/Lazialize/oasis/commit/c63b61de70ce852d8182c0a4ec3ecf6af0a0aad2), [`af3e6d7`](https://github.com/Lazialize/oasis/commit/af3e6d78df2b1b9495312e9d530f7bb2474247f0), [`2523da0`](https://github.com/Lazialize/oasis/commit/2523da0f92a7c12fe4e5c322f023b13adcee2531), [`0d0ae66`](https://github.com/Lazialize/oasis/commit/0d0ae66e01e4f65ccb03774bc176019ea43651ad), [`1d7a640`](https://github.com/Lazialize/oasis/commit/1d7a6407ebdee9ef25cb5710ef0ede21b752ffa1)]:
  - @oasis/core@0.9.0
  - @oasis/linter@0.9.0

## 0.8.4

### Patch Changes

- [#23](https://github.com/Lazialize/oasis/pull/23) [`8872738`](https://github.com/Lazialize/oasis/commit/8872738104cb5569345801648a16c98a14be5b35) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: LSP server no longer leaks a pending validation timer or orphans diagnostics when a document
  transitions to the ignored route, and config-file detection now recognizes Windows-style
  backslash paths so config watch/reload works on Windows
- Updated dependencies [[`8251964`](https://github.com/Lazialize/oasis/commit/8251964082c2e24be03cb2852006b372e9a55153), [`ec5cd99`](https://github.com/Lazialize/oasis/commit/ec5cd99015e984f2bb20ae5435b2ede90a2ba324)]:
  - @oasis/core@0.8.4
  - @oasis/linter@0.8.4

## 0.8.3

### Patch Changes

- [#20](https://github.com/Lazialize/oasis/pull/20) [`682a8ab`](https://github.com/Lazialize/oasis/commit/682a8ab448d617fe514597c20ca233352ae0a8ee) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: CLI and LSP behavior fixes ahead of 1.0

  - `oasis lint` on an entry file that cannot be loaded now reports an error and exits 1, instead of silently reporting zero diagnostics and exiting 0
  - `oasis lint` now rejects unknown single-dash flags (e.g. `-format`) like `oasis bundle` already did, and both commands accept a `--` separator for entry paths that start with `-`
  - the LSP server clears published diagnostics when a standalone (non-project) document is closed, instead of leaving them in the Problems panel indefinitely

- Updated dependencies [[`682a8ab`](https://github.com/Lazialize/oasis/commit/682a8ab448d617fe514597c20ca233352ae0a8ee), [`0a04379`](https://github.com/Lazialize/oasis/commit/0a0437902aeffa9b185642dc347841d6ddc993c1), [`aee8902`](https://github.com/Lazialize/oasis/commit/aee8902abe95fd7ed7fc281f2f71989a1bb0eb02), [`d600ad9`](https://github.com/Lazialize/oasis/commit/d600ad9a5e36c21bf2e0bcb4aaf828f5a46da707)]:
  - @oasis/linter@0.8.3
  - @oasis/core@0.8.3

## 0.8.2

### Patch Changes

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

- [#18](https://github.com/Lazialize/oasis/pull/18) [`6bcb0b4`](https://github.com/Lazialize/oasis/commit/6bcb0b460f048ff9601aeec1f199821280bdaeed) Thanks [@Lazialize](https://github.com/Lazialize)! - Fix the LSP server crashing on an unhandled rejection: notification-driven async work (document open/change, debounced validation, initial project load, config file reload) is now run through a `runSafely` wrapper that catches and logs errors via `connection.console.error` instead of letting them escape as unhandled rejections, plus a top-level `unhandledRejection` listener as a last-resort net.

- Updated dependencies [[`fcda9cb`](https://github.com/Lazialize/oasis/commit/fcda9cb039ba28624e57914f40001e0e4b364c35), [`f5fdd29`](https://github.com/Lazialize/oasis/commit/f5fdd298e78b3604009c2515e47f0416d7f05770), [`efb4404`](https://github.com/Lazialize/oasis/commit/efb4404fc63dd50e1b97e24d12b380888484425b), [`8060414`](https://github.com/Lazialize/oasis/commit/8060414c1f890f599b820dfe93c8c9f94c5b1435), [`bb3a169`](https://github.com/Lazialize/oasis/commit/bb3a169ad6345fa0763b438c6e63341b62cc09d9)]:
  - @oasis/linter@0.8.2
  - @oasis/core@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @oasis/core@0.8.1
  - @oasis/linter@0.8.1

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
  - @oasis/linter@0.8.0

## 0.7.0

### Minor Changes

- [#12](https://github.com/Lazialize/oasis/pull/12) [`7d5b7e5`](https://github.com/Lazialize/oasis/commit/7d5b7e500c24bd368a03f5273861c5585ee02d55) Thanks [@Lazialize](https://github.com/Lazialize)! - `oasis lsp` gains two capabilities: Document Links, so a `$ref`'s file-path portion (excluding the
  `#/...` fragment) is clickable and jumps to the target file, and Workspace Symbols, to search
  component definitions and operations (by `operationId`) across every loaded project graph and open
  document, deduped when a file belongs to more than one graph.

- [#12](https://github.com/Lazialize/oasis/pull/12) [`a8fd19e`](https://github.com/Lazialize/oasis/commit/a8fd19e0659843e7eb925b593b2e72606569d44a) Thanks [@Lazialize](https://github.com/Lazialize)! - `oasis lsp` gains two code actions: "Remove unused component" now deletes the whole component
  entry as before, and additionally collapses its section key (and `components:` itself) when the
  removal empties them; a new "Inline reference" refactor replaces a `$ref` with its resolved
  target's content, re-indented in place, working across files. It's not offered when the target
  doesn't resolve, would loop back into one of the ref's own ancestors, is a 3.1 `$ref` with
  meaningful sibling keys, is a whole Path Item `$ref` under `paths`/`webhooks`, or (for cross-file
  refs) the target's subtree contains a relative ref to a third file that would break once copied.

### Patch Changes

- [#12](https://github.com/Lazialize/oasis/pull/12) [`68e50b0`](https://github.com/Lazialize/oasis/commit/68e50b00ac7f3243e837f0322cd9ab67fba88a68) Thanks [@Lazialize](https://github.com/Lazialize)! - Fix `oasis lsp` diagnostics to actually resolve `lint.rules`/`lint.overrides` from the project's
  `oasis.config.jsonc` (previously it silently re-read config from disk via the CLI's loader, so
  overrides and severity changes in an unsaved config buffer — and, in tests, any config that wasn't
  also present on real disk — never took effect). Diagnostics for project entries now use the
  already-loaded, overlay-aware project config directly; standalone (non-project) open documents
  still discover the nearest `oasis.config.jsonc` upward, also through the overlay. Editing a config
  file to invalid JSONC now keeps the last-good project loaded (with a parse-error diagnostic on the
  config file) instead of unloading it.

- [#12](https://github.com/Lazialize/oasis/pull/12) [`49e3f93`](https://github.com/Lazialize/oasis/commit/49e3f933064e2cb5cd8542d7960ce4a635f905b9) Thanks [@Lazialize](https://github.com/Lazialize)! - Fixes to the v0.7 LSP work: config resolution now goes through a single, cached
  `resolveConfigForEntry` so project-member and standalone documents (and connection.ts's config
  warnings) always agree on which `oasis.config.jsonc` governs a file; editing an override-only
  config (no `entries`) now re-lints already-open standalone documents instead of only taking effect
  on an unrelated edit; a config file that exists but fails to parse no longer gets silently skipped
  in favor of an ancestor's config; a config whose first-ever load is invalid JSONC now surfaces a
  warning instead of being dropped silently. Workspace symbols no longer omit a project whose graph
  was evicted by closing an unrelated document, now resolve operations behind `$ref`'d path items
  (not just `$ref`'d fragments), and are memoized per document/graph. Symbol ranges (workspace and
  document symbols) no longer overshoot into trailing whitespace/comments. Document Links now
  compute the file-part range from the raw source, fixing incorrect ranges for double-quoted `$ref`
  values containing escape sequences.
- Updated dependencies []:
  - @oasis/core@0.7.0
  - @oasis/linter@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies []:
  - @oasis/core@0.6.0
  - @oasis/linter@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`602a03c`](https://github.com/Lazialize/oasis/commit/602a03c8d6cd614237965523dde2b155dc4b6a1c), [`8175852`](https://github.com/Lazialize/oasis/commit/8175852fc9fa327e685f2254d11afacbb844e48f), [`9da0fe7`](https://github.com/Lazialize/oasis/commit/9da0fe7dae5d9b5c4a46b51a3eca91872665e18f)]:
  - @oasis/linter@0.5.0
  - @oasis/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`e5667b7`](https://github.com/Lazialize/oasis/commit/e5667b76d865caa63b7d1767c14c1780d1d9844b), [`06f9367`](https://github.com/Lazialize/oasis/commit/06f9367ceb75f747fdb4e11f21adb70c5077c104), [`e5715fa`](https://github.com/Lazialize/oasis/commit/e5715fa7c5233ab6270dab7466bcf5271d5fffc4), [`3dd4215`](https://github.com/Lazialize/oasis/commit/3dd4215685da82dff206aa2905014af5aa5405e5)]:
  - @oasis/linter@0.4.0
  - @oasis/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`01eea54`](https://github.com/Lazialize/oasis/commit/01eea5490e1ec876513beabc6616ac8cd82f34ad), [`d09740e`](https://github.com/Lazialize/oasis/commit/d09740e2f04b42bdb3951a4f4382af2516fab231), [`30f8d97`](https://github.com/Lazialize/oasis/commit/30f8d97429d7cd5d0bd2537aed2a8344a3388a1b), [`974beec`](https://github.com/Lazialize/oasis/commit/974beeca579c7813fa5bd1de36fa8ba440e527f6), [`e0f9ed3`](https://github.com/Lazialize/oasis/commit/e0f9ed329249dc48ed49068b99ad66d279daa645)]:
  - @oasis/linter@0.3.0
  - @oasis/core@0.3.0

## 0.2.0

### Minor Changes

- [`be64699`](https://github.com/Lazialize/oasis/commit/be646998f95fbe713d9c2edeeab1b3ba05105da5) Thanks [@Lazialize](https://github.com/Lazialize)! - Initial release: OpenAPI linter with position-preserving diagnostics, multi-file bundler, language server (LSP), and the `oasis` CLI. Includes the companion VS Code extension.

### Patch Changes

- Updated dependencies [[`be64699`](https://github.com/Lazialize/oasis/commit/be646998f95fbe713d9c2edeeab1b3ba05105da5)]:
  - @oasis/core@0.2.0
  - @oasis/linter@0.2.0
