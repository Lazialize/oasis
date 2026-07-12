# @oasis/server

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
