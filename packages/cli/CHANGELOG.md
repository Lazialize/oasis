# @oasis/cli

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

- [#14](https://github.com/Lazialize/oasis/pull/14) [`134c8cb`](https://github.com/Lazialize/oasis/commit/134c8cb4dee217c8e6ce06bfbaaaef078ba0f3d9) Thanks [@Lazialize](https://github.com/Lazialize)! - The release workflow now publishes the VS Code extension to the Marketplace (`vsce publish
--packagePath`, gated on a `VSCE_PAT` secret) and updates the `Lazialize/homebrew-oasis` tap's
  `Formula/oasis.rb` from the release binaries (gated on a `HOMEBREW_TAP_TOKEN` secret) after each
  GitHub Release. Removed `"private": true` from `editors/vscode/package.json`, which was blocking
  Marketplace publishing. See `docs/releasing.md` for the secrets these steps require.

### Patch Changes

- Updated dependencies [[`e7bc9c4`](https://github.com/Lazialize/oasis/commit/e7bc9c42099913a43a3449162f3ded39fadba011)]:
  - @oasis/core@0.8.0
  - @oasis/linter@0.8.0
  - @oasis/bundler@0.8.0
  - @oasis/server@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`7d5b7e5`](https://github.com/Lazialize/oasis/commit/7d5b7e500c24bd368a03f5273861c5585ee02d55), [`68e50b0`](https://github.com/Lazialize/oasis/commit/68e50b00ac7f3243e837f0322cd9ab67fba88a68), [`a8fd19e`](https://github.com/Lazialize/oasis/commit/a8fd19e0659843e7eb925b593b2e72606569d44a), [`49e3f93`](https://github.com/Lazialize/oasis/commit/49e3f933064e2cb5cd8542d7960ce4a635f905b9)]:
  - @oasis/server@0.7.0
  - @oasis/bundler@0.7.0
  - @oasis/core@0.7.0
  - @oasis/linter@0.7.0

## 0.6.0

### Minor Changes

- [#10](https://github.com/Lazialize/oasis/pull/10) [`85ea11a`](https://github.com/Lazialize/oasis/commit/85ea11a4239a185324542b60f80cb3f1a0812d57) Thanks [@Lazialize](https://github.com/Lazialize)! - `oasis bundle --dereference` fully inlines every `$ref` — internal and external — as a deep,
  recursive copy of its resolved target, instead of lifting external refs into `components/*`.
  Components only reachable via a (now-inlined) `$ref` are dropped from the output; components
  unreachable from anywhere are kept verbatim, matching the existing (non-dereferenced) bundle
  behavior for unreferenced entry components. A `$ref` whose expansion would revisit a target
  already being expanded (a reference cycle) can't be inlined: that occurrence is kept as a `$ref`
  to a minimal `components/*` entry for the cycle's target, and a warning diagnostic is emitted
  naming the cycle. Output is deterministic (same input → byte-identical output). The bundler's
  `bundle()` entry point gains an additive `dereference` option (default `false`).

### Patch Changes

- Updated dependencies [[`85ea11a`](https://github.com/Lazialize/oasis/commit/85ea11a4239a185324542b60f80cb3f1a0812d57)]:
  - @oasis/bundler@0.6.0
  - @oasis/core@0.6.0
  - @oasis/linter@0.6.0
  - @oasis/server@0.6.0

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

- [#8](https://github.com/Lazialize/oasis/pull/8) [`79dd952`](https://github.com/Lazialize/oasis/commit/79dd952568314b716bbe4ff188a868361bafa55b) Thanks [@Lazialize](https://github.com/Lazialize)! - `oasis lint --format sarif` emits a SARIF 2.1.0 log on stdout, suitable for upload to GitHub Code
  Scanning via `github/codeql-action/upload-sarif`. Rule severities map to SARIF levels
  (error/warning/info → error/warning/note), locations use repo-relative (cwd-relative) URIs when
  possible and fall back to absolute `file://` URIs for diagnostics outside the working directory,
  and the `rules` array is deduped to only the rules that actually produced results. README documents
  the recipe under the `oasis lint` command docs.

### Patch Changes

- Updated dependencies [[`602a03c`](https://github.com/Lazialize/oasis/commit/602a03c8d6cd614237965523dde2b155dc4b6a1c), [`8175852`](https://github.com/Lazialize/oasis/commit/8175852fc9fa327e685f2254d11afacbb844e48f), [`9da0fe7`](https://github.com/Lazialize/oasis/commit/9da0fe7dae5d9b5c4a46b51a3eca91872665e18f)]:
  - @oasis/linter@0.5.0
  - @oasis/core@0.5.0
  - @oasis/bundler@0.5.0
  - @oasis/server@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`e5667b7`](https://github.com/Lazialize/oasis/commit/e5667b76d865caa63b7d1767c14c1780d1d9844b), [`06f9367`](https://github.com/Lazialize/oasis/commit/06f9367ceb75f747fdb4e11f21adb70c5077c104), [`e5715fa`](https://github.com/Lazialize/oasis/commit/e5715fa7c5233ab6270dab7466bcf5271d5fffc4), [`3dd4215`](https://github.com/Lazialize/oasis/commit/3dd4215685da82dff206aa2905014af5aa5405e5)]:
  - @oasis/linter@0.4.0
  - @oasis/bundler@0.4.0
  - @oasis/server@0.4.0
  - @oasis/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`01eea54`](https://github.com/Lazialize/oasis/commit/01eea5490e1ec876513beabc6616ac8cd82f34ad), [`d09740e`](https://github.com/Lazialize/oasis/commit/d09740e2f04b42bdb3951a4f4382af2516fab231), [`30f8d97`](https://github.com/Lazialize/oasis/commit/30f8d97429d7cd5d0bd2537aed2a8344a3388a1b), [`974beec`](https://github.com/Lazialize/oasis/commit/974beeca579c7813fa5bd1de36fa8ba440e527f6), [`e0f9ed3`](https://github.com/Lazialize/oasis/commit/e0f9ed329249dc48ed49068b99ad66d279daa645)]:
  - @oasis/linter@0.3.0
  - @oasis/core@0.3.0
  - @oasis/bundler@0.3.0
  - @oasis/server@0.3.0

## 0.2.0

### Minor Changes

- [`be64699`](https://github.com/Lazialize/oasis/commit/be646998f95fbe713d9c2edeeab1b3ba05105da5) Thanks [@Lazialize](https://github.com/Lazialize)! - Initial release: OpenAPI linter with position-preserving diagnostics, multi-file bundler, language server (LSP), and the `oasis` CLI. Includes the companion VS Code extension.

### Patch Changes

- Updated dependencies [[`be64699`](https://github.com/Lazialize/oasis/commit/be646998f95fbe713d9c2edeeab1b3ba05105da5)]:
  - @oasis/core@0.2.0
  - @oasis/linter@0.2.0
  - @oasis/bundler@0.2.0
  - @oasis/server@0.2.0
