# @oasis/bundler

## 0.9.0

### Patch Changes

- [#68](https://github.com/Lazialize/oasis/pull/68) [`23b466f`](https://github.com/Lazialize/oasis/commit/23b466f5ae7f8e0c98eaa663ae224de657d34577) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: bundler and bundle CLI bug fixes

  - Whole-document `$ref`s under 3.1 `components/pathItems` are now lifted into `components/pathItems` (not `components/schemas`), matching how a fragment ref to a path item already behaved ([#27](https://github.com/Lazialize/oasis/issues/27))
  - Specification Extension (`x-*`) payloads are treated as opaque data when bundling: structural-looking keys inside them (`$ref`, `mapping`, `schema`, `properties`, `examples`, ...) are copied through verbatim instead of being rewritten as references ([#28](https://github.com/Lazialize/oasis/issues/28))
  - `--dereference` reference-cycle slots now go through the same reserved-name/`uniqueName` allocation as normal lifted components, so a cycle slot can no longer overwrite an existing component whose name collides with the pointer tail; each cycle site emits a single deduplicated warning ([#29](https://github.com/Lazialize/oasis/issues/29))
  - `oasis bundle` no longer aborts when only an external `$ref` target is missing: it now matches the bundler API, emitting the bundle with the unresolved reference left verbatim plus a warning (exit 0). Genuine syntax errors and entry-load failures still abort with exit 2 ([#30](https://github.com/Lazialize/oasis/issues/30))
  - In `--dereference` mode, retention of unreferenced entry-document components is now independent of source declaration order: preservation is decided up front, so semantically equivalent component maps always retain the same members ([#63](https://github.com/Lazialize/oasis/issues/63))

- Updated dependencies [[`1fd7cbe`](https://github.com/Lazialize/oasis/commit/1fd7cbe435d552d2f9258f438f99d0358c84fb46), [`ffbd8d1`](https://github.com/Lazialize/oasis/commit/ffbd8d1a10694bdc0874b6863b2819c0af32cab0), [`0d0ae66`](https://github.com/Lazialize/oasis/commit/0d0ae66e01e4f65ccb03774bc176019ea43651ad)]:
  - @oasis/core@0.9.0

## 0.8.4

### Patch Changes

- [#23](https://github.com/Lazialize/oasis/pull/23) [`8251964`](https://github.com/Lazialize/oasis/commit/8251964082c2e24be03cb2852006b372e9a55153) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: bundler and core bug fixes

  - `discriminator.mapping` values shaped like a reference (e.g. `dog: './dog.yaml#/Dog'` or `dog: '#/components/schemas/Dog'`) are now discovered by the workspace graph (a file referenced only from a mapping is loaded) and rewritten consistently with the equivalent sibling `$ref` when bundling; bare component-name mapping values (e.g. `cat: Cat`) are left untouched
  - `detectVersion` no longer misdetects the OpenAPI version when `openapi:` is written as an unquoted YAML number: `openapi: 3.0` now correctly detects as 3.0 (previously undetectable) and `openapi: 3.10` no longer misdetects as 3.1
  - bundling a Path Item `$ref` chain that exceeds the depth guard now emits a warning diagnostic and leaves the `$ref` unresolved in place, instead of incorrectly lifting the Path Item into `components/schemas`

- Updated dependencies [[`8251964`](https://github.com/Lazialize/oasis/commit/8251964082c2e24be03cb2852006b372e9a55153)]:
  - @oasis/core@0.8.4

## 0.8.3

### Patch Changes

- [#20](https://github.com/Lazialize/oasis/pull/20) [`d1d74d9`](https://github.com/Lazialize/oasis/commit/d1d74d9c9162801b8ba1352bf2690ee77d7583fe) Thanks [@Lazialize](https://github.com/Lazialize)! - Fix bundling of Path Item Objects in webhook and callback positions. Root-level 3.1 `webhooks`
  entries and the runtime-expression entries of a Callback Object are now recognized as Path Item
  slots: a path-item `$ref` there is inlined in place (with 3.1 `summary`/`description` siblings
  preserved) instead of being invalidly lifted into `components`. A `$ref` at `callbacks/<name>`
  (a whole Callback Object) still lifts into `components/callbacks`, and refs inside an inlined path
  item are still lifted normally.
- Updated dependencies [[`0a04379`](https://github.com/Lazialize/oasis/commit/0a0437902aeffa9b185642dc347841d6ddc993c1), [`aee8902`](https://github.com/Lazialize/oasis/commit/aee8902abe95fd7ed7fc281f2f71989a1bb0eb02), [`d600ad9`](https://github.com/Lazialize/oasis/commit/d600ad9a5e36c21bf2e0bcb4aaf828f5a46da707)]:
  - @oasis/core@0.8.3

## 0.8.2

### Patch Changes

- [#18](https://github.com/Lazialize/oasis/pull/18) [`8060414`](https://github.com/Lazialize/oasis/commit/8060414c1f890f599b820dfe93c8c9f94c5b1435) Thanks [@Lazialize](https://github.com/Lazialize)! - Fix four `$ref`/pointer handling bugs: (1) a `$ref`'s file and fragment parts are now percent-decoded (`./petstore%20v2.yaml` resolves the file `petstore v2.yaml`; fragment segments are percent-decoded before `~1`/`~0` unescaping), tolerating a malformed `%` instead of throwing; (2) a literal `{"$ref": ...}` value nested under a schema's `example`/`default`/`enum`/`const` (or a 3.1 `examples` array) is treated as plain data instead of a reference, so it no longer triggers a spurious unresolved-ref diagnostic during graph loading or gets rewritten by the bundler — while this stays parent-context aware, so a genuine Reference Object that merely happens to sit at an entry named `default`/`example`/etc. (a `responses.default`, a map-form `examples` entry, a schema `properties` entry) is still followed and rewritten; (3) the bundler now preserves `summary`/`description` siblings on a Path Item `$ref` (3.1) in both the resolved and unresolved cases instead of dropping them; (4) `nodeAtPosition` now resolves a cursor on a map _key_ (not just its value) to that pair's pointer, fixing hover/definition/rename on a `$ref` (or any) key.

- [#18](https://github.com/Lazialize/oasis/pull/18) [`bb3a169`](https://github.com/Lazialize/oasis/commit/bb3a169ad6345fa0763b438c6e63341b62cc09d9) Thanks [@Lazialize](https://github.com/Lazialize)! - Fix YAML anchor/alias handling across the core walkers and the bundler. Aliased values (`*anchor`, including `<<` merge-key references) were previously invisible to the parser and bundler: a `$ref` reachable only through an alias was never found, duplicate keys inside an aliased map went undetected, pointer traversal couldn't descend through aliases, and the bundler silently dropped aliased keys (e.g. `Derived: *base`) from its output. Aliases are now resolved to their anchored target (with source ranges preserved) before dispatch, guarded against cyclic/self-referential aliases. Also clamp `offsetAtPosition` so out-of-range line/character positions map to the end of the document/line instead of offset 0.

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

- Updated dependencies []:
  - @oasis/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`8175852`](https://github.com/Lazialize/oasis/commit/8175852fc9fa327e685f2254d11afacbb844e48f)]:
  - @oasis/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @oasis/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`30f8d97`](https://github.com/Lazialize/oasis/commit/30f8d97429d7cd5d0bd2537aed2a8344a3388a1b)]:
  - @oasis/core@0.3.0

## 0.2.0

### Minor Changes

- [`be64699`](https://github.com/Lazialize/oasis/commit/be646998f95fbe713d9c2edeeab1b3ba05105da5) Thanks [@Lazialize](https://github.com/Lazialize)! - Initial release: OpenAPI linter with position-preserving diagnostics, multi-file bundler, language server (LSP), and the `oasis` CLI. Includes the companion VS Code extension.

### Patch Changes

- Updated dependencies [[`be64699`](https://github.com/Lazialize/oasis/commit/be646998f95fbe713d9c2edeeab1b3ba05105da5)]:
  - @oasis/core@0.2.0
