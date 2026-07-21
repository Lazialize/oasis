# @oasis/server

## 0.10.2

### Patch Changes

- Updated dependencies [[`3eb7095`](https://github.com/Lazialize/oasis/commit/3eb70958e28125ae7983fa5e095970c05553e5bb)]:
  - @oasis/linter@0.10.2
  - @oasis/core@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies []:
  - @oasis/core@0.10.1
  - @oasis/linter@0.10.1

## 0.10.0

### Minor Changes

- [#216](https://github.com/Lazialize/oasis/pull/216) [`a70619f`](https://github.com/Lazialize/oasis/commit/a70619f516dd42abb425ee03640268ee29e8f3f9) Thanks [@Lazialize](https://github.com/Lazialize)! - Add OpenAPI 3.2 support across version detection, reference resolution, linting, bundling, and language-server completion/symbol features. This includes `$self`, `query` and `additionalOperations`, reusable media types and sequential encoding, expanded examples and security schemes, Security Requirement URI references, and the new 3.2 metadata fields.

### Patch Changes

- Updated dependencies [[`a70619f`](https://github.com/Lazialize/oasis/commit/a70619f516dd42abb425ee03640268ee29e8f3f9)]:
  - @oasis/core@0.10.0
  - @oasis/linter@0.10.0

## 0.9.4

### Patch Changes

- [#200](https://github.com/Lazialize/oasis/pull/200) [`f51d2dd`](https://github.com/Lazialize/oasis/commit/f51d2ddbf227b444e88b6b7d08429cad413fc09f) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): canonicalize physical file identity across symlinks and case aliases. `NodeFileSystem.canonicalize` previously only ran `path.resolve`, so a symlinked directory alias or a differently-cased path on a case-insensitive filesystem (default macOS/Windows) could enter the workspace graph as a second, duplicate document instead of being recognised as the same physical file. `canonicalize` now recovers the real, on-disk-cased path (memoized per instance to avoid extra syscalls on hot lookups), falling back to a deterministic lexical path for references that don't exist on disk yet, and to an ancestor's resolved identity when only part of the path exists. `$ref` target lookups (`loadWorkspaceGraph` and `resolveRef`) canonicalize `file:` resource URIs the same way, so cycle detection and reference resolution also see one identity per physical file across aliased spellings. The LSP server canonicalizes open-document URIs, workspace roots, and config entries the same way (while still replying on the exact URI the client opened), and the CLI bundle command looks its entry up by the graph's canonical entry path.

- [#202](https://github.com/Lazialize/oasis/pull/202) [`feff144`](https://github.com/Lazialize/oasis/commit/feff144bbbc0a7c7e0388c5b8386d2235c95f56a) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): clamp `offsetAtPosition` to the real document and CRLF line boundaries. Out-of-range LSP positions (a character past the final line, or a line past the last line) previously produced offsets far beyond the source text, and a character past a CRLF-terminated line clamped to the LF byte instead of the position before the `\r\n` sequence. `offsetAtPosition` now takes the document's source text alongside the `LineCounter` so it can bound every result to `[0, text.length]` and detect `\r\n` vs `\n` line terminators when clamping. All server callers (`refs.ts`, `component-target.ts`, `completion.ts`, `code-actions.ts`) pass `doc.text` through accordingly.

- [#194](https://github.com/Lazialize/oasis/pull/194) [`ed2cf75`](https://github.com/Lazialize/oasis/commit/ed2cf758645045d234d8e7c43ffe229803147567) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): tokenize comments, escapes, and document prefixes in the OpenAPI root-key guard. The
  "looks like OpenAPI" guard scanned comment text as mapping content, so `{ # openapi: fake ... }`
  (YAML) and `{ // "openapi": "fake" ... }` (JSONC) matched as false positives; conversely, JSON
  string escapes were copied rather than decoded (a key spelled with escapes such as
  `{"open\u0061pi": ...}` never matched, and an escaped backslash before a closing quote desynced
  the scanner), and flow roots preceded by a `---` document marker, `%YAML` directive, or leading
  comment lines were missed. The guard now skips YAML/JSONC comments while scanning flow content,
  decodes double-quoted JSON string escapes before comparing keys against `openapi`, and skips a
  bounded document prefix (blank lines, comment lines, directives, and a `---` marker) before
  classifying the root, while staying root-aware. The mirrored guard in the VS Code extension
  receives the same fix.

- [#196](https://github.com/Lazialize/oasis/pull/196) [`accc685`](https://github.com/Lazialize/oasis/commit/accc6851e2286dd0277742802256ad86ca38e73a) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): stop treating ref-like strings in literal data (Schema Object `example`, `examples`,
  `default`, `enum`, `const`, and `x-*` Specification Extension payloads) as `$ref`s for definition,
  hover, and rename. `findRefAtPosition` previously classified any scalar containing `#/` or starting
  with `./`/`../` as a reference by text shape alone, so a value like `example: '#/components/schemas/Foo'`
  could be navigated to, hovered over, and used to initiate a rename that edited the `Foo` component's
  definition while leaving the example string itself untouched. It now recognizes reference occurrences
  semantically, via the same `findRefs` walk that builds the workspace graph (which already treats
  literal-data contexts as opaque), plus an explicit check for Link Object `operationRef`, which the
  core walk doesn't track but which must keep resolving.

- [#206](https://github.com/Lazialize/oasis/pull/206) [`81a0a9f`](https://github.com/Lazialize/oasis/commit/81a0a9f2e0bfe6bd493cbcdde4f1510f34e4f5d2) Thanks [@Lazialize](https://github.com/Lazialize)! - perf(server): lazy-load all workspace graphs only for `components/no-unused` code action. Previously, every code-action request eagerly loaded all project entry graphs to check for cross-entry references, even for simple operation ID/description/parameter fixes and extract/inline refactorings that only need the current document's graph. This added unnecessary I/O and latency. Now, all graphs are loaded only when the `components/no-unused` destructive quick fix is offered, keeping routine editor requests fast.

- [#203](https://github.com/Lazialize/oasis/pull/203) [`f79f7ad`](https://github.com/Lazialize/oasis/commit/f79f7adafad93d9f99756e5ac7debf28e2a4cdc9) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): percent-encode generated file paths in `$ref` completions and code-action edits.
  `relativeRefPath` (used by cross-file `$ref` completion, extract-to-component, and inline/relocate)
  returned the raw, unencoded result of `node:path.relative`, so a target filename containing `#`
  produced a reference like `./foo#bar.yaml#/components/schemas/Foo` — indistinguishable from a
  `./foo` file part with a `bar.yaml#/components/schemas/Foo` fragment, so the generated reference
  was unresolved. Other reserved/special characters (`%`, spaces, quotes, non-ASCII) could likewise
  produce invalid URI or YAML/JSON text. Each relative path segment is now percent-encoded as a URI
  reference (leaving only RFC 3986 unreserved characters literal), so a generated reference always
  resolves back to the intended file and can never smuggle a raw quote into the surrounding YAML
  single-quoted or JSON double-quoted scalar.

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

- [#207](https://github.com/Lazialize/oasis/pull/207) [`907f650`](https://github.com/Lazialize/oasis/commit/907f6507f7551fe2a6e0f2c1b0d7227fc0e8fff3) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): revalidate open standalone entries when a watched file is created. When a file is created that could satisfy an unresolved `$ref` in a currently-open standalone entry (an entry without a project config), the server now revalidates that entry so the unresolved diagnostic is cleared. Previously, the diagnostic would linger until the entry document was edited or reopened. This fix applies to standalone entries only; project-member entries were already handled correctly.

- [#195](https://github.com/Lazialize/oasis/pull/195) [`181b215`](https://github.com/Lazialize/oasis/commit/181b215a582a60817bf4bf5b861d08592c0512fd) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): quote YAML-sensitive path parameter names in quick fixes. Parameter names that are reserved YAML keywords (true, false, null), numeric-looking strings, or contain special characters are now properly quoted when inserted as parameter definitions. This ensures that the generated YAML parses correctly and the parameter name round-trips as the intended string value, not as a boolean, null, or number.

- Updated dependencies [[`f51d2dd`](https://github.com/Lazialize/oasis/commit/f51d2ddbf227b444e88b6b7d08429cad413fc09f), [`2a49d0d`](https://github.com/Lazialize/oasis/commit/2a49d0dd8dd4a55945861e56ed781cab6bb9f22c), [`feff144`](https://github.com/Lazialize/oasis/commit/feff144bbbc0a7c7e0388c5b8386d2235c95f56a), [`d2118d6`](https://github.com/Lazialize/oasis/commit/d2118d6188b42e56f5bbbd9c48c40cbfe813d467), [`9d82d70`](https://github.com/Lazialize/oasis/commit/9d82d700cb9fa98720309d46d9222c1d85e70111), [`18d7a3e`](https://github.com/Lazialize/oasis/commit/18d7a3e4ae57618089c9fed94f48a8b3f46b8e48), [`c5c1c69`](https://github.com/Lazialize/oasis/commit/c5c1c69e7d5b527d6d1f13eed3b0a01e3898a14c)]:
  - @oasis/core@0.9.4
  - @oasis/linter@0.9.4

## 0.9.3

### Patch Changes

- [#175](https://github.com/Lazialize/oasis/pull/175) [`e044f2d`](https://github.com/Lazialize/oasis/commit/e044f2dbb2864516c7f2be26b778823983b33514) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): reconcile open documents and pending validations when project entries are removed. An
  entry dropped from `entries` (config edit or a watched-file config change) now has its pending
  debounced validation cancelled so a stale timer can't republish its diagnostics after the clear, and
  a still-open removed entry is rerouted from its overlay text and validated as standalone if it's
  still a root OpenAPI document, instead of being left cleared and unvalidated until it's next edited
  or reopened.

- [#173](https://github.com/Lazialize/oasis/pull/173) [`7c91e87`](https://github.com/Lazialize/oasis/commit/7c91e877765e9e25c5b09c214afdd2e7c7bd7eba) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): preserve document URI identity for `untitled:` and `vscode-remote:` documents. The
  language server no longer collapses non-`file:` document URIs into a lossy filesystem path — it now
  maps each such URI to a stable synthetic graph path and back, so the open buffer is read from the
  overlay (instead of ENOENT-ing on disk) and every diagnostic/response is reported on the original
  document URI.

- [#187](https://github.com/Lazialize/oasis/pull/187) [`2eaaa65`](https://github.com/Lazialize/oasis/commit/2eaaa65ba612e1f3ea47cc6b13d601d58811dbde) Thanks [@Lazialize](https://github.com/Lazialize)! - Reload LSP projects when workspace folders change. Added roots are scanned and validated, removed
  roots have their projects, diagnostics, and cached graphs unloaded, and open documents are rerouted
  against the new workspace topology. The VS Code extension also recomputes project mode and
  reconciles open-document synchronization after folder additions and removals.
- Updated dependencies [[`eabf340`](https://github.com/Lazialize/oasis/commit/eabf3402212e78c6998527d3b7bc1c961a8e8ce7), [`df64a2d`](https://github.com/Lazialize/oasis/commit/df64a2d18aa03bd3da47842e1a0f3b76ed6e1ec2), [`01e1073`](https://github.com/Lazialize/oasis/commit/01e10737db05b69d3865662c57b62622190de7f3), [`bc1aa7c`](https://github.com/Lazialize/oasis/commit/bc1aa7c5adcc285da3a024403c2d141e4e8eaf04)]:
  - @oasis/linter@0.9.3
  - @oasis/core@0.9.3

## 0.9.2

### Patch Changes

- [#169](https://github.com/Lazialize/oasis/pull/169) [`ce2a63c`](https://github.com/Lazialize/oasis/commit/ce2a63c5e0dd047ee5f9628917ea813d96d9e44a) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): suppress YAML code actions that would apply block-style edits inside flow-style
  mappings or sequences ([#120](https://github.com/Lazialize/oasis/issues/120)).

- [#164](https://github.com/Lazialize/oasis/pull/164) [`ac12549`](https://github.com/Lazialize/oasis/commit/ac12549f91c734db574e3a6d940283b23430f8fb) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): emit syntax-valid completion edits for JSON/JSONC documents. Completion items were
  always serialized as YAML, so accepting a key inserted a bare `servers: ` and accepting a `$ref`
  target inserted a single-quoted `'#/components/schemas/Pet'` — both invalid JSON. Key completions in
  `.json`/`.jsonc` documents now insert double-quoted, escaped keys (`"servers": `) with a leading
  comma when a preceding sibling member lacks one, and are only offered where a safe, comma-correct
  edit is possible (appending a member; contexts that would need a trailing comma after an unwritten
  value offer no edit). Empty `$ref` values now insert a double-quoted target. YAML behavior is
  unchanged ([#117](https://github.com/Lazialize/oasis/issues/117)).

- [#167](https://github.com/Lazialize/oasis/pull/167) [`629b3b9`](https://github.com/Lazialize/oasis/commit/629b3b902da2c852db3e696550f8609f3b2ce3dd) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(linter): attach `paths/params-defined` missing-parameter diagnostics to the path template's
  owning key instead of the resolved Path Item file. When a path template like `/pets/{id}` `$ref`s an
  external Path Item, the "no matching `in: path` parameter" diagnostic previously reported against the
  resolved Path Item's file/range — a location that contains neither the template nor `{id}` — which
  also caused `# oasis-disable-*` suppressions and `lint.overrides` to be evaluated against the wrong
  file. The diagnostic now attaches to the `/pets/{id}` key in the entry document that declares it,
  pointing at the `{id}` placeholder's own span where possible. The `server` package's "Add parameter
  definition" quick fix is updated to match diagnostics at the template key while still editing the
  path item's actual (possibly different-file) body ([#109](https://github.com/Lazialize/oasis/issues/109)).

- [#170](https://github.com/Lazialize/oasis/pull/170) [`caf4abf`](https://github.com/Lazialize/oasis/commit/caf4abf777570a20754f5f9d9e8ebc69c29a35f6) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): infer whole-document OpenAPI fragment kinds from their incoming `$ref` contexts. Root
  completion and hover now recognize Schema, Path Item, Response, and Parameter Object files even
  when their contents are empty or lack discriminating keys, while preserving OpenAPI 3.0 versus 3.1
  Schema Object completions.
- Updated dependencies [[`78f9f6c`](https://github.com/Lazialize/oasis/commit/78f9f6c1bcf4c14c1023e748c4f78ba245c04fed), [`870bb1e`](https://github.com/Lazialize/oasis/commit/870bb1e26911aff521279bc7e49035f2dcaabb3a), [`2b3ffd3`](https://github.com/Lazialize/oasis/commit/2b3ffd39114a33451058674e2cc583523fa42aea), [`629b3b9`](https://github.com/Lazialize/oasis/commit/629b3b902da2c852db3e696550f8609f3b2ce3dd), [`0f434bd`](https://github.com/Lazialize/oasis/commit/0f434bdc0683950f264d3efed498a6e668f11ffa), [`0fd6eef`](https://github.com/Lazialize/oasis/commit/0fd6eefb0e8511d6c076187775a7cd178550ea1e), [`f9859ba`](https://github.com/Lazialize/oasis/commit/f9859baaadcd38de16130c1fc8acb94637720f94), [`b287d15`](https://github.com/Lazialize/oasis/commit/b287d159395928877035de951398906b1ae904db)]:
  - @oasis/linter@0.9.2
  - @oasis/core@0.9.2

## 0.9.1

### Patch Changes

- [#138](https://github.com/Lazialize/oasis/pull/138) [`5922117`](https://github.com/Lazialize/oasis/commit/5922117ebf93e1c8221c309c5beb39706e111bb9) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): classify raw URI references before decoding filesystem paths, and resolve `file:` URLs
  with URL path semantics so encoded delimiters remain valid relative filenames ([#93](https://github.com/Lazialize/oasis/issues/93)).

- [#134](https://github.com/Lazialize/oasis/pull/134) [`fc76aa5`](https://github.com/Lazialize/oasis/commit/fc76aa5d5db62ab87048d5600793c90cb255b913) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): restrict implicit security-scheme and discriminator reference discovery to semantic
  OpenAPI contexts. Bare Security Requirement keys are now only collected on the root and Operation
  Objects, and discriminator `mapping` names only on actual Schema Objects; lookalike `security` and
  `discriminator.mapping` structures inside literal-data contexts (`example`, `examples`, `default`,
  `enum`, `const`, and `x-*` vendor extensions) are skipped, so find-references and rename no longer
  rewrite documented example payloads ([#118](https://github.com/Lazialize/oasis/issues/118)).

- [#133](https://github.com/Lazialize/oasis/pull/133) [`1373876`](https://github.com/Lazialize/oasis/commit/1373876e3148d497e067b19091fe6ec0217e0711) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(cli): make multi-entry `oasis lint` project-aware — sibling entry graphs now contribute
  `externalDocuments` so shared components used only by another entry aren't flagged unused, and
  exact-duplicate diagnostics from a shared file are merged instead of doubled ([#76](https://github.com/Lazialize/oasis/issues/76)).

- [#139](https://github.com/Lazialize/oasis/pull/139) [`e47a592`](https://github.com/Lazialize/oasis/commit/e47a592a02c790a9b212fa1b1c06f86197e5b4c9) Thanks [@Lazialize](https://github.com/Lazialize)! - Preserve `$ref`-shaped application data in Example and Link Object fields instead of loading or rewriting it, while retaining semantic reference, named-container, discriminator, Path Item, callback, and component handling through YAML aliases.

- [#136](https://github.com/Lazialize/oasis/pull/136) [`4703c5c`](https://github.com/Lazialize/oasis/commit/4703c5c41ce9bae7c3627defcc2285ddd3d907e0) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(server): the extract/inline relocation planner now uses core's semantic reference discovery
  instead of a raw `$ref` key walk. Genuine references — real `$ref`s and `discriminator.mapping`
  URI values — are rebased to preserve their canonical targets across directories, while
  `$ref`-shaped scalars buried in literal instance data (`example`/`default`/`enum`/`const`) are left
  untouched. Adds `findSubtreeRefs` to `@oasis/core` so the planner shares the exact literal-context
  and discriminator rules used by linting and graph loading ([#119](https://github.com/Lazialize/oasis/issues/119)).

- [#145](https://github.com/Lazialize/oasis/pull/145) [`2b48229`](https://github.com/Lazialize/oasis/commit/2b482291d789695ba7c2b933eca521a800b83fc3) Thanks [@Lazialize](https://github.com/Lazialize)! - Resolve OpenAPI 3.1 schema references and anchors against the nearest canonical `$id` resource, including standalone external Schema Documents and aliased schemas reached under distinct resource scopes.

- [#146](https://github.com/Lazialize/oasis/pull/146) [`ce7df6a`](https://github.com/Lazialize/oasis/commit/ce7df6a0bc11cd550d2259f2bca4e0708908addb) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): separate plain RFC 6901 JSON Pointer parsing from `$ref` URI-fragment decoding, so a
  literal percent-escape-looking key (e.g. `%7Bid%7D`) resolves to itself instead of being conflated
  with a differently-encoded sibling key. `nodeAtPointer`/`formatPointer` no longer percent-decode or
  percent-encode; a new `parseFragmentPointer` performs exactly one URI-decoding pass before the RFC
  6901 walk, used only where a pointer comes from a `$ref` fragment ([#96](https://github.com/Lazialize/oasis/issues/96)).
- Updated dependencies [[`e32667c`](https://github.com/Lazialize/oasis/commit/e32667c5ad5cd0beda604a5068db3a4ab46f3e11), [`44c136f`](https://github.com/Lazialize/oasis/commit/44c136fd230b7978d0735f01db1b894ac7cc8d92), [`5922117`](https://github.com/Lazialize/oasis/commit/5922117ebf93e1c8221c309c5beb39706e111bb9), [`f06312f`](https://github.com/Lazialize/oasis/commit/f06312fdaa04e7aa45ef59f370e5254879ec183b), [`65c6479`](https://github.com/Lazialize/oasis/commit/65c64799353d47867dc7fe9a42430f23ebb76d1d), [`1373876`](https://github.com/Lazialize/oasis/commit/1373876e3148d497e067b19091fe6ec0217e0711), [`e47a592`](https://github.com/Lazialize/oasis/commit/e47a592a02c790a9b212fa1b1c06f86197e5b4c9), [`8326582`](https://github.com/Lazialize/oasis/commit/83265828dc4c310a11824744c9d5bebcd919e656), [`4703c5c`](https://github.com/Lazialize/oasis/commit/4703c5c41ce9bae7c3627defcc2285ddd3d907e0), [`fed1780`](https://github.com/Lazialize/oasis/commit/fed178004410e6d8baf9719079309b687255d678), [`cba5e4c`](https://github.com/Lazialize/oasis/commit/cba5e4cf3816c5cef431e86dec7e23ecef9e57ae), [`2b48229`](https://github.com/Lazialize/oasis/commit/2b482291d789695ba7c2b933eca521a800b83fc3), [`ce7df6a`](https://github.com/Lazialize/oasis/commit/ce7df6a0bc11cd550d2259f2bca4e0708908addb)]:
  - @oasis/core@0.9.1
  - @oasis/linter@0.9.1

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
