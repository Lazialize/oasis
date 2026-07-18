# @oasis/bundler

## 0.9.3

### Patch Changes

- [#177](https://github.com/Lazialize/oasis/pull/177) [`919542a`](https://github.com/Lazialize/oasis/commit/919542ae31028e687591b10504caaeb095ae8973) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(bundler): preserve source order for integer-like mapping keys. Bundling built plain JS objects,
  whose integer-index property names (status codes like `"404"`/`"200"`, numeric component/schema
  names like `"10"`/`"2"`) JS enumerates in ascending numeric order — silently reordering them in the
  output even though the bundler's contract is to keep authored key order. The bundler now records key
  insertion order as it builds each map and serializes through an ordered representation (`Map` for
  YAML plus a small ordered JSON writer), so integer-like keys retain their source order in both YAML
  and JSON output, deterministically across runs.

- [#190](https://github.com/Lazialize/oasis/pull/190) [`119e121`](https://github.com/Lazialize/oasis/commit/119e1210e52cd0fb991831ad0560deec095c7b16) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(bundler): preserve unknown OpenAPI 3.1 Schema Object keyword payloads as opaque data instead of
  interpreting OpenAPI-shaped property names inside them as structural fields.
- Updated dependencies [[`01e1073`](https://github.com/Lazialize/oasis/commit/01e10737db05b69d3865662c57b62622190de7f3), [`bc1aa7c`](https://github.com/Lazialize/oasis/commit/bc1aa7c5adcc285da3a024403c2d141e4e8eaf04)]:
  - @oasis/core@0.9.3

## 0.9.2

### Patch Changes

- [#160](https://github.com/Lazialize/oasis/pull/160) [`7d0b365`](https://github.com/Lazialize/oasis/commit/7d0b36525ff7f07272205931f98c1d33d427048d) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(bundler): rewrite `mapping` values only inside actual Discriminator Objects. The bundler
  previously rewrote any map reached under a key literally named `mapping`, even when it was an
  unrelated OpenAPI 3.1 Schema Object property (3.1 Schema Objects may carry arbitrary custom
  vocabulary keywords). `mapping` is now rewritten as a `discriminator.mapping` reference only when
  it is the direct child of an actual Discriminator Object (i.e. reached via `Schema.discriminator`),
  matching the context tracking `packages/core/src/ref.ts` already used for reference discovery. A
  `mapping` property anywhere else is now left untouched as plain data ([#97](https://github.com/Lazialize/oasis/issues/97)).

- [#165](https://github.com/Lazialize/oasis/pull/165) [`6a84c56`](https://github.com/Lazialize/oasis/commit/6a84c56bcc3990d4b088f33fd0a52a3c50c712de) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(bundler): retain `discriminator.mapping` targets in `--dereference` bundles. In dereference
  mode, a schema reached only by a `oneOf`/`anyOf` `$ref` was inlined and dropped from
  `components/*` even when a sibling `discriminator.mapping` entry — an explicit
  `#/components/schemas/<Name>` pointer or a bare component name like `dog: Dog` — still pointed at
  it. A mapping value is always a bare string and can't hold inlined content, so the bundle ended up
  with a dangling mapping target that failed `refs/no-unresolved` and `structure/discriminator` when
  linted. Every schema that is a discriminator mapping target (pointer-form or bare name) is now kept
  as a real `components/*` entry regardless of whether dereferencing otherwise visited and inlined it
  elsewhere ([#88](https://github.com/Lazialize/oasis/issues/88)).
- Updated dependencies [[`0fd6eef`](https://github.com/Lazialize/oasis/commit/0fd6eefb0e8511d6c076187775a7cd178550ea1e)]:
  - @oasis/core@0.9.2

## 0.9.1

### Patch Changes

- [#135](https://github.com/Lazialize/oasis/pull/135) [`534839d`](https://github.com/Lazialize/oasis/commit/534839d2ea25b4b1eebf5f508dda346814312875) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(bundler): preserve `__proto__` keys in bundled output instead of silently dropping them.
  Component names, schema property names, literal payload keys, and extension payload keys are now
  assigned as own data properties, so a key literally named `__proto__` (a valid OpenAPI component
  name and a valid arbitrary schema property name) no longer triggers the legacy
  `Object.prototype.__proto__` setter and disappears from the bundle ([#99](https://github.com/Lazialize/oasis/issues/99)).

- [#147](https://github.com/Lazialize/oasis/pull/147) [`e32667c`](https://github.com/Lazialize/oasis/commit/e32667c5ad5cd0beda604a5068db3a4ab46f3e11) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(bundler): canonicalize resolved target identities before component deduplication. A resolved
  `$ref` now carries a canonical RFC 6901 pointer within its resource (`ResolvedRef.canonicalPointer`):
  URI percent-encoding is decoded at the fragment layer and an anchor is mapped to the pointer of the
  node it names. The bundler keys component deduplication and `--dereference` cycle detection on this
  canonical identity (resource + canonical pointer) instead of the raw input fragment spelling, so
  URI-equivalent references — percent-encoding variants like `#/components/schemas/Foo` vs
  `#/components/schemas/%46oo`, or an anchor vs a JSON Pointer to the same node — lift a single shared
  component rather than duplicating it (e.g. `Foo` and `Foo_2`). Distinct embedded `$id` resources
  stay separate ([#95](https://github.com/Lazialize/oasis/issues/95)).

- [#142](https://github.com/Lazialize/oasis/pull/142) [`44c136f`](https://github.com/Lazialize/oasis/commit/44c136fd230b7978d0735f01db1b894ac7cc8d92) Thanks [@Lazialize](https://github.com/Lazialize)! - Share version-aware named-entry container semantics across reference, anchor, and bundle traversal.

- [#148](https://github.com/Lazialize/oasis/pull/148) [`dc8d475`](https://github.com/Lazialize/oasis/commit/dc8d4754968232ae391500ed87c3f0236cc3784e) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(bundler): preserve version- and object-specific `$ref` sibling semantics when dereferencing.
  `--dereference` no longer shallow-merges every sibling of a `$ref` onto the inlined target, which
  silently changed document meaning. Sibling handling now branches on the OpenAPI version and whether
  the `$ref` sits in a Schema Object or a Reference Object position: OpenAPI 3.0 Reference Object (and
  Schema Object) siblings are ignored per JSON Reference semantics; OpenAPI 3.1 Reference Object
  siblings allow only `summary`/`description` overrides; and OpenAPI 3.1 Schema Object siblings are
  preserved as a conjunction via `allOf: [<target>, {<siblings>}]` so conflicting keywords, arrays, and
  boolean-schema targets are never lost (`x-*` extension annotations attach directly rather than joining
  the conjunction). Applies to both YAML and JSON output ([#87](https://github.com/Lazialize/oasis/issues/87)).

- [#141](https://github.com/Lazialize/oasis/pull/141) [`65c6479`](https://github.com/Lazialize/oasis/commit/65c64799353d47867dc7fe9a42430f23ebb76d1d) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core,bundler): keep every value below a Specification Extension opaque during reference and
  anchor discovery and across root, Paths, Callback, and `$ref` sibling bundling paths ([#91](https://github.com/Lazialize/oasis/issues/91)).

- [#139](https://github.com/Lazialize/oasis/pull/139) [`e47a592`](https://github.com/Lazialize/oasis/commit/e47a592a02c790a9b212fa1b1c06f86197e5b4c9) Thanks [@Lazialize](https://github.com/Lazialize)! - Preserve `$ref`-shaped application data in Example and Link Object fields instead of loading or rewriting it, while retaining semantic reference, named-container, discriminator, Path Item, callback, and component handling through YAML aliases.

- [#140](https://github.com/Lazialize/oasis/pull/140) [`8326582`](https://github.com/Lazialize/oasis/commit/83265828dc4c310a11824744c9d5bebcd919e656) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(bundler): preserve numeric literals beyond JavaScript `Number` precision when bundling ([#98](https://github.com/Lazialize/oasis/issues/98)).
  Large integers (past `Number.MAX_SAFE_INTEGER`, e.g. int64 values) and high-precision or
  exponent-form decimals used in `const`/`default`/`example`, bounds, `multipleOf`, and arbitrary
  extension data are now emitted byte-for-byte from the original source in both YAML and JSON output
  instead of the rounded value. Values that round-trip exactly (and cosmetic forms like `1.0` or
  `1e3`) are unchanged, JSON output never throws on internally large values, and source ranges,
  aliases, and linter numeric checks are unaffected.

- [#144](https://github.com/Lazialize/oasis/pull/144) [`fed1780`](https://github.com/Lazialize/oasis/commit/fed178004410e6d8baf9719079309b687255d678) Thanks [@Lazialize](https://github.com/Lazialize)! - Discover OpenAPI 3.1 Schema `$dynamicRef` dependencies and report dynamic references that cannot yet be made self-contained during bundling. Entry-owned fragment-only dynamic references keep their static fallback and dynamic behavior; relocating dynamic scope from external resources remains explicitly unsupported.

- [#145](https://github.com/Lazialize/oasis/pull/145) [`2b48229`](https://github.com/Lazialize/oasis/commit/2b482291d789695ba7c2b933eca521a800b83fc3) Thanks [@Lazialize](https://github.com/Lazialize)! - Resolve OpenAPI 3.1 schema references and anchors against the nearest canonical `$id` resource, including standalone external Schema Documents and aliased schemas reached under distinct resource scopes.

- [#146](https://github.com/Lazialize/oasis/pull/146) [`ce7df6a`](https://github.com/Lazialize/oasis/commit/ce7df6a0bc11cd550d2259f2bca4e0708908addb) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): separate plain RFC 6901 JSON Pointer parsing from `$ref` URI-fragment decoding, so a
  literal percent-escape-looking key (e.g. `%7Bid%7D`) resolves to itself instead of being conflated
  with a differently-encoded sibling key. `nodeAtPointer`/`formatPointer` no longer percent-decode or
  percent-encode; a new `parseFragmentPointer` performs exactly one URI-decoding pass before the RFC
  6901 walk, used only where a pointer comes from a `$ref` fragment ([#96](https://github.com/Lazialize/oasis/issues/96)).
- Updated dependencies [[`e32667c`](https://github.com/Lazialize/oasis/commit/e32667c5ad5cd0beda604a5068db3a4ab46f3e11), [`44c136f`](https://github.com/Lazialize/oasis/commit/44c136fd230b7978d0735f01db1b894ac7cc8d92), [`5922117`](https://github.com/Lazialize/oasis/commit/5922117ebf93e1c8221c309c5beb39706e111bb9), [`f06312f`](https://github.com/Lazialize/oasis/commit/f06312fdaa04e7aa45ef59f370e5254879ec183b), [`65c6479`](https://github.com/Lazialize/oasis/commit/65c64799353d47867dc7fe9a42430f23ebb76d1d), [`e47a592`](https://github.com/Lazialize/oasis/commit/e47a592a02c790a9b212fa1b1c06f86197e5b4c9), [`8326582`](https://github.com/Lazialize/oasis/commit/83265828dc4c310a11824744c9d5bebcd919e656), [`4703c5c`](https://github.com/Lazialize/oasis/commit/4703c5c41ce9bae7c3627defcc2285ddd3d907e0), [`fed1780`](https://github.com/Lazialize/oasis/commit/fed178004410e6d8baf9719079309b687255d678), [`cba5e4c`](https://github.com/Lazialize/oasis/commit/cba5e4cf3816c5cef431e86dec7e23ecef9e57ae), [`2b48229`](https://github.com/Lazialize/oasis/commit/2b482291d789695ba7c2b933eca521a800b83fc3), [`ce7df6a`](https://github.com/Lazialize/oasis/commit/ce7df6a0bc11cd550d2259f2bca4e0708908addb)]:
  - @oasis/core@0.9.1

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
