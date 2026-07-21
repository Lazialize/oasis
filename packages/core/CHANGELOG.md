# @oasis/core

## 0.10.3

### Patch Changes

- [#225](https://github.com/Lazialize/oasis/pull/225) [`f9862c0`](https://github.com/Lazialize/oasis/commit/f9862c037cb15ed46e8e34d6c6372a0819818af5) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): reject `$ref` JSON Pointer fragments with a malformed tilde escape (e.g. `~2`, or the
  percent-encoded `%7E2`) instead of resolving them as literal text. Per RFC 6901, `~` may only occur
  as `~0` or `~1` inside a pointer token; a fragment containing any other `~` sequence now fails
  resolution with a source-ranged "unresolved reference" diagnostic instead of silently targeting a
  real (but unintended) document node. Valid `~0`/`~1` escapes and plain-name anchor fragments are
  unaffected ([#211](https://github.com/Lazialize/oasis/issues/211)).

## 0.10.2

## 0.10.1

## 0.10.0

### Minor Changes

- [#216](https://github.com/Lazialize/oasis/pull/216) [`a70619f`](https://github.com/Lazialize/oasis/commit/a70619f516dd42abb425ee03640268ee29e8f3f9) Thanks [@Lazialize](https://github.com/Lazialize)! - Add OpenAPI 3.2 support across version detection, reference resolution, linting, bundling, and language-server completion/symbol features. This includes `$self`, `query` and `additionalOperations`, reusable media types and sequential encoding, expanded examples and security schemes, Security Requirement URI references, and the new 3.2 metadata fields.

## 0.9.4

### Patch Changes

- [#200](https://github.com/Lazialize/oasis/pull/200) [`f51d2dd`](https://github.com/Lazialize/oasis/commit/f51d2ddbf227b444e88b6b7d08429cad413fc09f) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): canonicalize physical file identity across symlinks and case aliases. `NodeFileSystem.canonicalize` previously only ran `path.resolve`, so a symlinked directory alias or a differently-cased path on a case-insensitive filesystem (default macOS/Windows) could enter the workspace graph as a second, duplicate document instead of being recognised as the same physical file. `canonicalize` now recovers the real, on-disk-cased path (memoized per instance to avoid extra syscalls on hot lookups), falling back to a deterministic lexical path for references that don't exist on disk yet, and to an ancestor's resolved identity when only part of the path exists. `$ref` target lookups (`loadWorkspaceGraph` and `resolveRef`) canonicalize `file:` resource URIs the same way, so cycle detection and reference resolution also see one identity per physical file across aliased spellings. The LSP server canonicalizes open-document URIs, workspace roots, and config entries the same way (while still replying on the exact URI the client opened), and the CLI bundle command looks its entry up by the graph's canonical entry path.

- [#192](https://github.com/Lazialize/oasis/pull/192) [`2a49d0d`](https://github.com/Lazialize/oasis/commit/2a49d0dd8dd4a55945861e56ed781cab6bb9f22c) Thanks [@Lazialize](https://github.com/Lazialize)! - refactor(core): centralize the version-aware OpenAPI object-edge and JSON Schema
  applicator transition tables in a single internal module (`semantic-traversal.ts`).
  Reference discovery (`findRefs`) and anchor/resource indexing (`buildAnchorIndex`)
  previously each maintained their own copies of the schema-applicator key sets, HTTP
  method set, and object-kind transition functions, so a new applicator or object
  position could be added to one walker but silently omitted from the other. Both
  walkers now consume one authoritative table while keeping their specialized outputs
  and caches. No behavior change.

- [#202](https://github.com/Lazialize/oasis/pull/202) [`feff144`](https://github.com/Lazialize/oasis/commit/feff144bbbc0a7c7e0388c5b8386d2235c95f56a) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): clamp `offsetAtPosition` to the real document and CRLF line boundaries. Out-of-range LSP positions (a character past the final line, or a line past the last line) previously produced offsets far beyond the source text, and a character past a CRLF-terminated line clamped to the LF byte instead of the position before the `\r\n` sequence. `offsetAtPosition` now takes the document's source text alongside the `LineCounter` so it can bound every result to `[0, text.length]` and detect `\r\n` vs `\n` line terminators when clamping. All server callers (`refs.ts`, `component-target.ts`, `completion.ts`, `code-actions.ts`) pass `doc.text` through accordingly.

- [#197](https://github.com/Lazialize/oasis/pull/197) [`9d82d70`](https://github.com/Lazialize/oasis/commit/9d82d700cb9fa98720309d46d9222c1d85e70111) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): diagnose duplicate canonical JSON Schema resource identifiers. When two different
  documents (or embedded resources) declared the same canonical `$id`, `loadWorkspaceGraph` let
  whichever one was indexed last silently win, so a `$ref` to that URI could resolve to the wrong
  schema with no diagnostic. The workspace graph now detects the collision while merging anchor
  indexes, emits a source-ranged `no-duplicate-schema-id` diagnostic naming both documents (stable
  regardless of load order), and makes the colliding URI unresolvable instead of resolving it to
  either claimant. Retrieval aliases and re-indexing the same document as schema-aware after being
  first reached generically are unaffected.

- [#199](https://github.com/Lazialize/oasis/pull/199) [`18d7a3e`](https://github.com/Lazialize/oasis/commit/18d7a3e4ae57618089c9fed94f48a8b3f46b8e48) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): recognize percent-encoded component pointer segments in references and rename.
  `$ref`s like `#/components/schemas/%46oo` (RFC 6901 §6 URI-fragment percent-encoding for `Foo`)
  resolved correctly for definition navigation, but find-references and rename discarded them:
  `collectComponentReferences` compared a resolved ref's raw, still-encoded pointer spelling against
  the target's canonical (decoded) pointer, so an encoded segment could never match. It now compares
  against `resolved.canonicalPointer`, and `componentNameSegmentRange` locates the name's source range
  by decoding each raw fragment segment (percent-encoding and JSON Pointer `~0`/`~1`) instead of
  searching for the decoded literal in the source text, so the returned range always spans the exact
  encoded source span — preserving any nested pointer suffix and leaving plain, unencoded references
  unaffected.

## 0.9.3

### Patch Changes

- [#176](https://github.com/Lazialize/oasis/pull/176) [`01e1073`](https://github.com/Lazialize/oasis/commit/01e10737db05b69d3865662c57b62622190de7f3) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): recognize RFC 3986-compliant one-character URI schemes. The `uriScheme`
  function now correctly accepts valid single-letter schemes like `x:thing`, instead of
  blanket-rejecting them to avoid Windows drive paths. Windows paths (`C:\path`, `C:/path`)
  are now explicitly detected by checking for the drive-path pattern (single letter
  followed by `:` and a path separator) rather than rejecting all one-character schemes,
  which was too broad and broke custom URI schemes and hierarchical URIs like `z://`.

- [#172](https://github.com/Lazialize/oasis/pull/172) [`bc1aa7c`](https://github.com/Lazialize/oasis/commit/bc1aa7c5adcc285da3a024403c2d141e4e8eaf04) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): reject malformed RFC 6901 JSON Pointers in plain-pointer API. `parsePointer` now returns
  `undefined` for pointers that violate RFC 6901: non-empty pointers without a leading slash, and
  pointers with invalid tilde escapes (anything other than `~0` and `~1`). `nodeAtPointer` returns
  `undefined` when given an invalid pointer, instead of silently resolving it as a different valid
  pointer. URI-fragment tolerance remains a separate policy in `parseFragmentPointer` and does not
  weaken the plain RFC 6901 validation ([#152](https://github.com/Lazialize/oasis/issues/152)).

## 0.9.2

### Patch Changes

- [#157](https://github.com/Lazialize/oasis/pull/157) [`0fd6eef`](https://github.com/Lazialize/oasis/commit/0fd6eefb0e8511d6c076187775a7cd178550ea1e) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): preserve JSON Schema resource scope when `resolveRef` receives a raw string. A raw-string
  call previously recovered occurrence context only when accompanied by `refRange`, so it could fall
  back to plain document-relative filesystem resolution and silently return a different physical target
  than the equivalent `FoundRef` call — escaping the `$id` resource scope the reference was discovered
  under. `resolveRef` now matches a raw string against its recorded graph occurrence(s) by value (and
  `refRange`, when given) and reuses that occurrence's canonical base whenever it carries an explicit
  resource scope. When matching occurrences disagree on scope (e.g. an aliased reference scalar reused
  under multiple resource bases) the call now fails explicitly with an "Ambiguous reference" diagnostic
  instead of silently picking the first occurrence. Raw strings with no matching occurrence, or matching
  only the document's own default (non-`$id`-scoped) base, keep resolving exactly as before ([#149](https://github.com/Lazialize/oasis/issues/149)).

## 0.9.1

### Patch Changes

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

- [#138](https://github.com/Lazialize/oasis/pull/138) [`5922117`](https://github.com/Lazialize/oasis/commit/5922117ebf93e1c8221c309c5beb39706e111bb9) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): classify raw URI references before decoding filesystem paths, and resolve `file:` URLs
  with URL path semantics so encoded delimiters remain valid relative filenames ([#93](https://github.com/Lazialize/oasis/issues/93)).

- [#137](https://github.com/Lazialize/oasis/pull/137) [`f06312f`](https://github.com/Lazialize/oasis/commit/f06312fdaa04e7aa45ef59f370e5254879ec183b) Thanks [@Lazialize](https://github.com/Lazialize)! - Detect reference cycles by resolved target identity, including same-document cycles, without flagging unrelated mutual file dependencies.

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

- [#136](https://github.com/Lazialize/oasis/pull/136) [`4703c5c`](https://github.com/Lazialize/oasis/commit/4703c5c41ce9bae7c3627defcc2285ddd3d907e0) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): the extract/inline relocation planner now uses core's semantic reference discovery
  instead of a raw `$ref` key walk. Genuine references — real `$ref`s and `discriminator.mapping`
  URI values — are rebased to preserve their canonical targets across directories, while
  `$ref`-shaped scalars buried in literal instance data (`example`/`default`/`enum`/`const`) are left
  untouched. Adds `findSubtreeRefs` to `@oasis/core` so the planner shares the exact literal-context
  and discriminator rules used by linting and graph loading ([#119](https://github.com/Lazialize/oasis/issues/119)).

- [#144](https://github.com/Lazialize/oasis/pull/144) [`fed1780`](https://github.com/Lazialize/oasis/commit/fed178004410e6d8baf9719079309b687255d678) Thanks [@Lazialize](https://github.com/Lazialize)! - Discover OpenAPI 3.1 Schema `$dynamicRef` dependencies and report dynamic references that cannot yet be made self-contained during bundling. Entry-owned fragment-only dynamic references keep their static fallback and dynamic behavior; relocating dynamic scope from external resources remains explicitly unsupported.

- [#143](https://github.com/Lazialize/oasis/pull/143) [`cba5e4c`](https://github.com/Lazialize/oasis/commit/cba5e4cf3816c5cef431e86dec7e23ecef9e57ae) Thanks [@Lazialize](https://github.com/Lazialize)! - Resolve YAML aliases and merge keys consistently before linting OpenAPI objects while retaining anchor source ranges.

- [#145](https://github.com/Lazialize/oasis/pull/145) [`2b48229`](https://github.com/Lazialize/oasis/commit/2b482291d789695ba7c2b933eca521a800b83fc3) Thanks [@Lazialize](https://github.com/Lazialize)! - Resolve OpenAPI 3.1 schema references and anchors against the nearest canonical `$id` resource, including standalone external Schema Documents and aliased schemas reached under distinct resource scopes.

- [#146](https://github.com/Lazialize/oasis/pull/146) [`ce7df6a`](https://github.com/Lazialize/oasis/commit/ce7df6a0bc11cd550d2259f2bca4e0708908addb) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): separate plain RFC 6901 JSON Pointer parsing from `$ref` URI-fragment decoding, so a
  literal percent-escape-looking key (e.g. `%7Bid%7D`) resolves to itself instead of being conflated
  with a differently-encoded sibling key. `nodeAtPointer`/`formatPointer` no longer percent-decode or
  percent-encode; a new `parseFragmentPointer` performs exactly one URI-decoding pass before the RFC
  6901 walk, used only where a pointer comes from a `$ref` fragment ([#96](https://github.com/Lazialize/oasis/issues/96)).

## 0.9.0

### Minor Changes

- [#69](https://github.com/Lazialize/oasis/pull/69) [`0d0ae66`](https://github.com/Lazialize/oasis/commit/0d0ae66e01e4f65ccb03774bc176019ea43651ad) Thanks [@Lazialize](https://github.com/Lazialize)! - Add URI-aware reference handling for OpenAPI 3.1 Schema Objects (JSON Schema 2020-12). Core now
  classifies `$ref` values with an RFC 3986-aware classifier (`classifyUriReference`, `uriScheme`,
  `isExternalUriReference`): absolute non-filesystem URIs (`https:`, `urn:`, ...) are reported as
  unsupported external references instead of being turned into bogus file lookups. For 3.1 documents,
  core builds a per-document anchor index (`buildAnchorIndex`, `resolveAnchor`) of `$id` scopes,
  `$anchor`, and `$dynamicAnchor`, and `resolveRef` resolves plain-name `#anchor` fragments
  (including percent-encoded ones) to their schema, preserving source ranges. OpenAPI Reference
  Objects and 3.0 documents keep their existing JSON-Pointer behavior.

### Patch Changes

- [#69](https://github.com/Lazialize/oasis/pull/69) [`1fd7cbe`](https://github.com/Lazialize/oasis/commit/1fd7cbe435d552d2f9258f438f99d0358c84fb46) Thanks [@Lazialize](https://github.com/Lazialize)! - Canonicalize the workspace-graph entry path before traversal. A relative entry document is no
  longer loaded a second time under its absolute path when another file `$ref`s back to it, so the
  entry is parsed once and cross-file cycle detection no longer misfires against a duplicate
  identity. `WorkspaceGraph.entryPath` now always holds the canonical path, and `FileSystem` gains a
  `canonicalize(path)` method.

- [#72](https://github.com/Lazialize/oasis/pull/72) [`ffbd8d1`](https://github.com/Lazialize/oasis/commit/ffbd8d1a10694bdc0874b6863b2819c0af32cab0) Thanks [@Lazialize](https://github.com/Lazialize)! - Classify discriminator mapping values as URI references correctly ([#39](https://github.com/Lazialize/oasis/issues/39)). A mapping value is a bare
  component name (expanded to `#/components/schemas/<name>`) only when it matches
  `^[a-zA-Z0-9._-]+$` and contains neither `/` nor `:`; anything else — a relative path
  (`./dog.yaml`, `../schemas/dog.yaml`), an absolute scheme without `//` (`urn:`), a fragment, or a
  percent-encoded reference — is a URI reference resolved with normal `$ref` semantics.
  `looksLikeMappingRef` in core (shared by reference discovery and the bundler) and the
  `structure/discriminator` / `components/no-unused` rules now agree on this classification, so
  valid relative references are no longer reported unresolved and `urn:`-style values are treated as
  external targets instead of bogus component names.

## 0.8.4

### Patch Changes

- [#23](https://github.com/Lazialize/oasis/pull/23) [`8251964`](https://github.com/Lazialize/oasis/commit/8251964082c2e24be03cb2852006b372e9a55153) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: bundler and core bug fixes

  - `discriminator.mapping` values shaped like a reference (e.g. `dog: './dog.yaml#/Dog'` or `dog: '#/components/schemas/Dog'`) are now discovered by the workspace graph (a file referenced only from a mapping is loaded) and rewritten consistently with the equivalent sibling `$ref` when bundling; bare component-name mapping values (e.g. `cat: Cat`) are left untouched
  - `detectVersion` no longer misdetects the OpenAPI version when `openapi:` is written as an unquoted YAML number: `openapi: 3.0` now correctly detects as 3.0 (previously undetectable) and `openapi: 3.10` no longer misdetects as 3.1
  - bundling a Path Item `$ref` chain that exceeds the depth guard now emits a warning diagnostic and leaves the `$ref` unresolved in place, instead of incorrectly lifting the Path Item into `components/schemas`

## 0.8.3

### Patch Changes

- [#20](https://github.com/Lazialize/oasis/pull/20) [`0a04379`](https://github.com/Lazialize/oasis/commit/0a0437902aeffa9b185642dc347841d6ddc993c1) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: core correctness fixes ahead of 1.0

  - `findRefs` no longer treats `$ref`-shaped literal data inside `example`/`default`/`enum`/`const` as a real reference when the enclosing property is named like a container keyword (`parameters`, `headers`, `schemas`, ...)
  - `formatPointer` now percent-encodes a literal `%` followed by hex digits so `formatPointer`/`parsePointer` are exact inverses (component names containing `%XX` resolve correctly)
  - a file that fails to load is attempted and diagnosed once, instead of once per referencing `$ref`
  - a leading BOM is stripped at parse time so first-line columns match what editors display

- [#20](https://github.com/Lazialize/oasis/pull/20) [`aee8902`](https://github.com/Lazialize/oasis/commit/aee8902abe95fd7ed7fc281f2f71989a1bb0eb02) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: accept patch-less openapi version values (3.0/3.1) in version detection

- [#20](https://github.com/Lazialize/oasis/pull/20) [`d600ad9`](https://github.com/Lazialize/oasis/commit/d600ad9a5e36c21bf2e0bcb4aaf828f5a46da707) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: suppression-comment and rule correctness fixes ahead of 1.0

  - `# oasis-disable-*` directives are now extracted from real YAML comment tokens (CST), so directive-looking text inside a block scalar or quoted string no longer silently suppresses diagnostics
  - `structure/field-types` and `structure/callbacks` no longer report `responses` as a missing required field on OpenAPI 3.1 documents (it is optional since 3.1)
  - `security/defined` now also validates scopes: oauth2 scopes must be declared by one of the scheme's flows, and only `oauth2`/`openIdConnect` requirements may list scopes

## 0.8.2

### Patch Changes

- [#18](https://github.com/Lazialize/oasis/pull/18) [`8060414`](https://github.com/Lazialize/oasis/commit/8060414c1f890f599b820dfe93c8c9f94c5b1435) Thanks [@Lazialize](https://github.com/Lazialize)! - Fix four `$ref`/pointer handling bugs: (1) a `$ref`'s file and fragment parts are now percent-decoded (`./petstore%20v2.yaml` resolves the file `petstore v2.yaml`; fragment segments are percent-decoded before `~1`/`~0` unescaping), tolerating a malformed `%` instead of throwing; (2) a literal `{"$ref": ...}` value nested under a schema's `example`/`default`/`enum`/`const` (or a 3.1 `examples` array) is treated as plain data instead of a reference, so it no longer triggers a spurious unresolved-ref diagnostic during graph loading or gets rewritten by the bundler — while this stays parent-context aware, so a genuine Reference Object that merely happens to sit at an entry named `default`/`example`/etc. (a `responses.default`, a map-form `examples` entry, a schema `properties` entry) is still followed and rewritten; (3) the bundler now preserves `summary`/`description` siblings on a Path Item `$ref` (3.1) in both the resolved and unresolved cases instead of dropping them; (4) `nodeAtPosition` now resolves a cursor on a map _key_ (not just its value) to that pair's pointer, fixing hover/definition/rename on a `$ref` (or any) key.

- [#18](https://github.com/Lazialize/oasis/pull/18) [`bb3a169`](https://github.com/Lazialize/oasis/commit/bb3a169ad6345fa0763b438c6e63341b62cc09d9) Thanks [@Lazialize](https://github.com/Lazialize)! - Fix YAML anchor/alias handling across the core walkers and the bundler. Aliased values (`*anchor`, including `<<` merge-key references) were previously invisible to the parser and bundler: a `$ref` reachable only through an alias was never found, duplicate keys inside an aliased map went undetected, pointer traversal couldn't descend through aliases, and the bundler silently dropped aliased keys (e.g. `Derived: *base`) from its output. Aliases are now resolved to their anchored target (with source ranges preserved) before dispatch, guarded against cyclic/self-referential aliases. Also clamp `offsetAtPosition` so out-of-range line/character positions map to the end of the document/line instead of offset 0.

## 0.8.1

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

## 0.7.0

## 0.6.0

## 0.5.0

### Patch Changes

- [#8](https://github.com/Lazialize/oasis/pull/8) [`8175852`](https://github.com/Lazialize/oasis/commit/8175852fc9fa327e685f2254d11afacbb844e48f) Thanks [@Lazialize](https://github.com/Lazialize)! - Lint performance: memoize `$ref` scanning and the `paths`/`webhooks`/`components` traversal
  helpers (`iteratePathItems`, `iterateOperations`, `iterateSchemas`, `iterateMediaTypes`) so
  repeated calls from independent rules within a single `lint()` run reuse work instead of
  re-walking the whole document graph each time; also cache YAML map key lookups so resolving a
  `$ref` into a large `components/schemas` map is no longer a linear scan per lookup. No behavior
  change — output is identical, just faster on large/multi-file specs.

## 0.4.0

## 0.3.0

### Minor Changes

- [#4](https://github.com/Lazialize/oasis/pull/4) [`30f8d97`](https://github.com/Lazialize/oasis/commit/30f8d97429d7cd5d0bd2537aed2a8344a3388a1b) Thanks [@Lazialize](https://github.com/Lazialize)! - Inline lint suppression via YAML comments: `# oasis-disable-next-line <rule...>` suppresses the
  listed rules (or all, with no names) for diagnostics on the following line, and
  `# oasis-disable-file <rule...>` does the same for the whole file. Suppression is resolved
  per-file, so a directive in a file reached only via `$ref` only affects diagnostics attributed to
  that file, and it flows through the shared lint engine so `oasis lint` and the LSP server honor it
  identically. Syntax errors are never suppressible. JSON documents don't support comments, so this
  is YAML-only; `@oasis/core` gains `extractSuppressions`/`isSuppressed` to support it.

## 0.2.0

### Minor Changes

- [`be64699`](https://github.com/Lazialize/oasis/commit/be646998f95fbe713d9c2edeeab1b3ba05105da5) Thanks [@Lazialize](https://github.com/Lazialize)! - Initial release: OpenAPI linter with position-preserving diagnostics, multi-file bundler, language server (LSP), and the `oasis` CLI. Includes the companion VS Code extension.
