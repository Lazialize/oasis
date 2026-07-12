# @oasis/server

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
