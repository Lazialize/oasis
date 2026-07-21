# @oasis/cli

## 0.10.2

### Patch Changes

- Updated dependencies [[`3eb7095`](https://github.com/Lazialize/oasis/commit/3eb70958e28125ae7983fa5e095970c05553e5bb)]:
  - @oasis/linter@0.10.2
  - @oasis/bundler@0.10.2
  - @oasis/server@0.10.2
  - @oasis/core@0.10.2

## 0.10.1

### Patch Changes

- [#219](https://github.com/Lazialize/oasis/pull/219) [`6816c62`](https://github.com/Lazialize/oasis/commit/6816c627ae4028628edf9c696bd646fc44cc182e) Thanks [@Lazialize](https://github.com/Lazialize)! - Accept the conventional `--stdio` transport flag on `oasis lsp` instead of rejecting it. LSP clients that declare the stdio transport (e.g. the VS Code extension via vscode-languageclient's `TransportKind.stdio`, and the same convention in Neovim/Helix/Emacs) append `--stdio` to the launch command. The server previously treated it as an unexpected argument and exited immediately, so the language server never started and restarting it surfaced an "unexpected argument \"--stdio\"" error. The flag is now a no-op (the server always speaks LSP over stdio).

- Updated dependencies []:
  - @oasis/bundler@0.10.1
  - @oasis/core@0.10.1
  - @oasis/linter@0.10.1
  - @oasis/server@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [[`a70619f`](https://github.com/Lazialize/oasis/commit/a70619f516dd42abb425ee03640268ee29e8f3f9)]:
  - @oasis/core@0.10.0
  - @oasis/linter@0.10.0
  - @oasis/bundler@0.10.0
  - @oasis/server@0.10.0

## 0.9.4

### Patch Changes

- [#200](https://github.com/Lazialize/oasis/pull/200) [`f51d2dd`](https://github.com/Lazialize/oasis/commit/f51d2ddbf227b444e88b6b7d08429cad413fc09f) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(core): canonicalize physical file identity across symlinks and case aliases. `NodeFileSystem.canonicalize` previously only ran `path.resolve`, so a symlinked directory alias or a differently-cased path on a case-insensitive filesystem (default macOS/Windows) could enter the workspace graph as a second, duplicate document instead of being recognised as the same physical file. `canonicalize` now recovers the real, on-disk-cased path (memoized per instance to avoid extra syscalls on hot lookups), falling back to a deterministic lexical path for references that don't exist on disk yet, and to an ancestor's resolved identity when only part of the path exists. `$ref` target lookups (`loadWorkspaceGraph` and `resolveRef`) canonicalize `file:` resource URIs the same way, so cycle detection and reference resolution also see one identity per physical file across aliased spellings. The LSP server canonicalizes open-document URIs, workspace roots, and config entries the same way (while still replying on the exact URI the client opened), and the CLI bundle command looks its entry up by the graph's canonical entry path.

- Updated dependencies [[`f51d2dd`](https://github.com/Lazialize/oasis/commit/f51d2ddbf227b444e88b6b7d08429cad413fc09f), [`2a49d0d`](https://github.com/Lazialize/oasis/commit/2a49d0dd8dd4a55945861e56ed781cab6bb9f22c), [`feff144`](https://github.com/Lazialize/oasis/commit/feff144bbbc0a7c7e0388c5b8386d2235c95f56a), [`d2118d6`](https://github.com/Lazialize/oasis/commit/d2118d6188b42e56f5bbbd9c48c40cbfe813d467), [`9d82d70`](https://github.com/Lazialize/oasis/commit/9d82d700cb9fa98720309d46d9222c1d85e70111), [`ed2cf75`](https://github.com/Lazialize/oasis/commit/ed2cf758645045d234d8e7c43ffe229803147567), [`accc685`](https://github.com/Lazialize/oasis/commit/accc6851e2286dd0277742802256ad86ca38e73a), [`81a0a9f`](https://github.com/Lazialize/oasis/commit/81a0a9f2e0bfe6bd493cbcdde4f1510f34e4f5d2), [`f79f7ad`](https://github.com/Lazialize/oasis/commit/f79f7adafad93d9f99756e5ac7debf28e2a4cdc9), [`18d7a3e`](https://github.com/Lazialize/oasis/commit/18d7a3e4ae57618089c9fed94f48a8b3f46b8e48), [`c5c1c69`](https://github.com/Lazialize/oasis/commit/c5c1c69e7d5b527d6d1f13eed3b0a01e3898a14c), [`907f650`](https://github.com/Lazialize/oasis/commit/907f6507f7551fe2a6e0f2c1b0d7227fc0e8fff3), [`181b215`](https://github.com/Lazialize/oasis/commit/181b215a582a60817bf4bf5b861d08592c0512fd)]:
  - @oasis/core@0.9.4
  - @oasis/server@0.9.4
  - @oasis/linter@0.9.4
  - @oasis/bundler@0.9.4

## 0.9.3

### Patch Changes

- [#189](https://github.com/Lazialize/oasis/pull/189) [`28711bf`](https://github.com/Lazialize/oasis/commit/28711bf5a363bfb9ce87b76fb0a7094c8763850c) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(cli): reject bundle entry documents whose root is not an OpenAPI object.

- Updated dependencies [[`eabf340`](https://github.com/Lazialize/oasis/commit/eabf3402212e78c6998527d3b7bc1c961a8e8ce7), [`df64a2d`](https://github.com/Lazialize/oasis/commit/df64a2d18aa03bd3da47842e1a0f3b76ed6e1ec2), [`919542a`](https://github.com/Lazialize/oasis/commit/919542ae31028e687591b10504caaeb095ae8973), [`e044f2d`](https://github.com/Lazialize/oasis/commit/e044f2dbb2864516c7f2be26b778823983b33514), [`01e1073`](https://github.com/Lazialize/oasis/commit/01e10737db05b69d3865662c57b62622190de7f3), [`7c91e87`](https://github.com/Lazialize/oasis/commit/7c91e877765e9e25c5b09c214afdd2e7c7bd7eba), [`119e121`](https://github.com/Lazialize/oasis/commit/119e1210e52cd0fb991831ad0560deec095c7b16), [`bc1aa7c`](https://github.com/Lazialize/oasis/commit/bc1aa7c5adcc285da3a024403c2d141e4e8eaf04), [`2eaaa65`](https://github.com/Lazialize/oasis/commit/2eaaa65ba612e1f3ea47cc6b13d601d58811dbde)]:
  - @oasis/linter@0.9.3
  - @oasis/bundler@0.9.3
  - @oasis/server@0.9.3
  - @oasis/core@0.9.3

## 0.9.2

### Patch Changes

- [#168](https://github.com/Lazialize/oasis/pull/168) [`8f49a22`](https://github.com/Lazialize/oasis/commit/8f49a221d7fb9ae37b67bbabb7e91c2fa321eb71) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(extension): suppress document-scoped LSP requests for files the VS Code client has not synchronized.

- [#163](https://github.com/Lazialize/oasis/pull/163) [`88a1fe9`](https://github.com/Lazialize/oasis/commit/88a1fe9ebff01c28173aceffaa4ddd8d0ffe8798) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(extension): include MIT license in packaged VSIX artifacts. The VS Code extension VSIX now contains the repository's LICENSE file, resolved at package time by copying it from the repository root. The CI workflow verifies that the packaged VSIX includes the LICENSE ([#82](https://github.com/Lazialize/oasis/issues/82)).

- Updated dependencies [[`78f9f6c`](https://github.com/Lazialize/oasis/commit/78f9f6c1bcf4c14c1023e748c4f78ba245c04fed), [`7d0b365`](https://github.com/Lazialize/oasis/commit/7d0b36525ff7f07272205931f98c1d33d427048d), [`6a84c56`](https://github.com/Lazialize/oasis/commit/6a84c56bcc3990d4b088f33fd0a52a3c50c712de), [`ce2a63c`](https://github.com/Lazialize/oasis/commit/ce2a63c5e0dd047ee5f9628917ea813d96d9e44a), [`ac12549`](https://github.com/Lazialize/oasis/commit/ac12549f91c734db574e3a6d940283b23430f8fb), [`870bb1e`](https://github.com/Lazialize/oasis/commit/870bb1e26911aff521279bc7e49035f2dcaabb3a), [`2b3ffd3`](https://github.com/Lazialize/oasis/commit/2b3ffd39114a33451058674e2cc583523fa42aea), [`629b3b9`](https://github.com/Lazialize/oasis/commit/629b3b902da2c852db3e696550f8609f3b2ce3dd), [`0f434bd`](https://github.com/Lazialize/oasis/commit/0f434bdc0683950f264d3efed498a6e668f11ffa), [`0fd6eef`](https://github.com/Lazialize/oasis/commit/0fd6eefb0e8511d6c076187775a7cd178550ea1e), [`f9859ba`](https://github.com/Lazialize/oasis/commit/f9859baaadcd38de16130c1fc8acb94637720f94), [`b287d15`](https://github.com/Lazialize/oasis/commit/b287d159395928877035de951398906b1ae904db), [`caf4abf`](https://github.com/Lazialize/oasis/commit/caf4abf777570a20754f5f9d9e8ebc69c29a35f6)]:
  - @oasis/linter@0.9.2
  - @oasis/bundler@0.9.2
  - @oasis/server@0.9.2
  - @oasis/core@0.9.2

## 0.9.1

### Patch Changes

- [#131](https://github.com/Lazialize/oasis/pull/131) [`eb20eb6`](https://github.com/Lazialize/oasis/commit/eb20eb6f151894c173b13e7798cc5d6af214c62a) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(cli): `oasis init` now detects every supported OpenAPI root form — uppercase extensions,
  UTF-8 BOMs, YAML flow mappings, document markers, and quoted keys — by reusing the shared
  root-aware detection instead of an ad-hoc regex, while still rejecting nested `openapi` keys ([#80](https://github.com/Lazialize/oasis/issues/80)).

- [#133](https://github.com/Lazialize/oasis/pull/133) [`1373876`](https://github.com/Lazialize/oasis/commit/1373876e3148d497e067b19091fe6ec0217e0711) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(cli): make multi-entry `oasis lint` project-aware — sibling entry graphs now contribute
  `externalDocuments` so shared components used only by another entry aren't flagged unused, and
  exact-duplicate diagnostics from a shared file are merged instead of doubled ([#76](https://github.com/Lazialize/oasis/issues/76)).

- [#132](https://github.com/Lazialize/oasis/pull/132) [`c5ed40f`](https://github.com/Lazialize/oasis/commit/c5ed40f4b9d436955c7ef42b25d42901d258a09f) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(cli): `oasis lsp` now validates its arguments — `-h`/`--help` prints command help and exits 0
  without starting the server, any other argument is rejected with exit code 2, and the bare command
  keeps its stdio behavior ([#81](https://github.com/Lazialize/oasis/issues/81)).

- [#128](https://github.com/Lazialize/oasis/pull/128) [`d6e04f5`](https://github.com/Lazialize/oasis/commit/d6e04f581428bcbfa01f700169055f44e9ed42d9) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(cli): classify rendered paths by real parent segments — in-tree names beginning with `..`
  (e.g. `..generated`) are kept repo-relative, and an absolute `path.relative` result (Windows
  cross-drive) is correctly treated as outside `cwd` ([#77](https://github.com/Lazialize/oasis/issues/77)).

- [#129](https://github.com/Lazialize/oasis/pull/129) [`f7c0dbe`](https://github.com/Lazialize/oasis/commit/f7c0dbe6ea4fa1a55fdf033cc5a107c293e351d8) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(cli): reject empty values in the `--flag=` syntax (e.g. `--config=`, `--out=`, `-o=`,
  `--format=`) so they fail with a usage error like the separated form, instead of being silently
  treated as no-config / stdout ([#79](https://github.com/Lazialize/oasis/issues/79)).

- [#127](https://github.com/Lazialize/oasis/pull/127) [`dbc63dd`](https://github.com/Lazialize/oasis/commit/dbc63dda385281d07eff0aaff3e1c8d3f92501e8) Thanks [@Lazialize](https://github.com/Lazialize)! - fix(cli): percent-encode repository-relative SARIF artifact URIs per RFC 3986 — spaces, `#`, `%`,
  and non-ASCII characters in filenames are now encoded (path separators preserved), so a valid
  filename like `spec#draft.yaml` is no longer parsed as a URI fragment ([#78](https://github.com/Lazialize/oasis/issues/78)).
- Updated dependencies [[`534839d`](https://github.com/Lazialize/oasis/commit/534839d2ea25b4b1eebf5f508dda346814312875), [`e32667c`](https://github.com/Lazialize/oasis/commit/e32667c5ad5cd0beda604a5068db3a4ab46f3e11), [`44c136f`](https://github.com/Lazialize/oasis/commit/44c136fd230b7978d0735f01db1b894ac7cc8d92), [`5922117`](https://github.com/Lazialize/oasis/commit/5922117ebf93e1c8221c309c5beb39706e111bb9), [`dc8d475`](https://github.com/Lazialize/oasis/commit/dc8d4754968232ae391500ed87c3f0236cc3784e), [`f06312f`](https://github.com/Lazialize/oasis/commit/f06312fdaa04e7aa45ef59f370e5254879ec183b), [`fc76aa5`](https://github.com/Lazialize/oasis/commit/fc76aa5d5db62ab87048d5600793c90cb255b913), [`65c6479`](https://github.com/Lazialize/oasis/commit/65c64799353d47867dc7fe9a42430f23ebb76d1d), [`1373876`](https://github.com/Lazialize/oasis/commit/1373876e3148d497e067b19091fe6ec0217e0711), [`e47a592`](https://github.com/Lazialize/oasis/commit/e47a592a02c790a9b212fa1b1c06f86197e5b4c9), [`8326582`](https://github.com/Lazialize/oasis/commit/83265828dc4c310a11824744c9d5bebcd919e656), [`4703c5c`](https://github.com/Lazialize/oasis/commit/4703c5c41ce9bae7c3627defcc2285ddd3d907e0), [`fed1780`](https://github.com/Lazialize/oasis/commit/fed178004410e6d8baf9719079309b687255d678), [`cba5e4c`](https://github.com/Lazialize/oasis/commit/cba5e4cf3816c5cef431e86dec7e23ecef9e57ae), [`2b48229`](https://github.com/Lazialize/oasis/commit/2b482291d789695ba7c2b933eca521a800b83fc3), [`ce7df6a`](https://github.com/Lazialize/oasis/commit/ce7df6a0bc11cd550d2259f2bca4e0708908addb)]:
  - @oasis/bundler@0.9.1
  - @oasis/core@0.9.1
  - @oasis/server@0.9.1
  - @oasis/linter@0.9.1

## 0.9.0

### Patch Changes

- [#68](https://github.com/Lazialize/oasis/pull/68) [`23b466f`](https://github.com/Lazialize/oasis/commit/23b466f5ae7f8e0c98eaa663ae224de657d34577) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: bundler and bundle CLI bug fixes

  - Whole-document `$ref`s under 3.1 `components/pathItems` are now lifted into `components/pathItems` (not `components/schemas`), matching how a fragment ref to a path item already behaved ([#27](https://github.com/Lazialize/oasis/issues/27))
  - Specification Extension (`x-*`) payloads are treated as opaque data when bundling: structural-looking keys inside them (`$ref`, `mapping`, `schema`, `properties`, `examples`, ...) are copied through verbatim instead of being rewritten as references ([#28](https://github.com/Lazialize/oasis/issues/28))
  - `--dereference` reference-cycle slots now go through the same reserved-name/`uniqueName` allocation as normal lifted components, so a cycle slot can no longer overwrite an existing component whose name collides with the pointer tail; each cycle site emits a single deduplicated warning ([#29](https://github.com/Lazialize/oasis/issues/29))
  - `oasis bundle` no longer aborts when only an external `$ref` target is missing: it now matches the bundler API, emitting the bundle with the unresolved reference left verbatim plus a warning (exit 0). Genuine syntax errors and entry-load failures still abort with exit 2 ([#30](https://github.com/Lazialize/oasis/issues/30))
  - In `--dereference` mode, retention of unreferenced entry-document components is now independent of source declaration order: preservation is decided up front, so semantically equivalent component maps always retain the same members ([#63](https://github.com/Lazialize/oasis/issues/63))

- [#71](https://github.com/Lazialize/oasis/pull/71) [`a2c079a`](https://github.com/Lazialize/oasis/commit/a2c079ab8d76102401724a7af554a44c83628838) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: `oasis lint`/`oasis bundle` argument parsing now respects `--` and rejects flag-looking option values ([#31](https://github.com/Lazialize/oasis/issues/31))

  - `--` now protects everything after it from being read as `-h`/`--help`, so a positional entry literally named `--help` is linted/bundled instead of printing help and exiting 0
  - An option that requires a value (`--config`, `--format`, `-o`/`--out`) now fails with a usage error when the next token is another recognized flag, instead of silently consuming it as the value
  - Added a `--flag=value` form as an explicit escape hatch for passing a dash-prefixed value

- [#71](https://github.com/Lazialize/oasis/pull/71) [`99c2b12`](https://github.com/Lazialize/oasis/commit/99c2b12cabe0d82870b8e1cd04afd008688e0f57) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: encode absolute SARIF artifact URIs with `pathToFileURL` ([#32](https://github.com/Lazialize/oasis/issues/32))

  `--format sarif`'s fallback absolute `file://` artifact location (used when a diagnostic's file is
  outside `cwd`) is now built with `node:url`'s `pathToFileURL` instead of string concatenation, so
  spaces, `#`, `%`, non-ASCII characters, and platform path syntax are correctly percent-encoded.
  Repo-relative, forward-slash URIs for files under `cwd` are unchanged.

- [#71](https://github.com/Lazialize/oasis/pull/71) [`1d7a640`](https://github.com/Lazialize/oasis/commit/1d7a6407ebdee9ef25cb5710ef0ede21b752ffa1) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: validate `oasis.config.jsonc` structure before resolving lint configuration ([#33](https://github.com/Lazialize/oasis/issues/33))

  Config files were syntax-checked as JSONC but then cast directly to the config type, so a
  structurally invalid shape (e.g. `"lint": {"overrides": {}}` where an array is expected) crashed
  `resolveConfig` with a TypeError. The complete config shape (`entries`, `lint`, `lint.rules`,
  `lint.overrides` and each override's `files`/`rules`) is now validated at the load boundary:
  invalid fields are dropped and reported as source-ranged `oasis/config` diagnostics (CLI) or
  config warnings (LSP) instead of crashing or being silently coerced.

- Updated dependencies [[`23b466f`](https://github.com/Lazialize/oasis/commit/23b466f5ae7f8e0c98eaa663ae224de657d34577), [`1fd7cbe`](https://github.com/Lazialize/oasis/commit/1fd7cbe435d552d2f9258f438f99d0358c84fb46), [`73ed5c6`](https://github.com/Lazialize/oasis/commit/73ed5c64dc171a52c12eb6cf1550eafbdc82912f), [`d52a1ec`](https://github.com/Lazialize/oasis/commit/d52a1ecef2625796996df0ce06c1a68f032ebe48), [`f963901`](https://github.com/Lazialize/oasis/commit/f96390109865155ec0627b47314141e19ffa3221), [`83e68e5`](https://github.com/Lazialize/oasis/commit/83e68e5c98b9544857f2d658977b56e772757071), [`ffbd8d1`](https://github.com/Lazialize/oasis/commit/ffbd8d1a10694bdc0874b6863b2819c0af32cab0), [`ffbd8d1`](https://github.com/Lazialize/oasis/commit/ffbd8d1a10694bdc0874b6863b2819c0af32cab0), [`94b9305`](https://github.com/Lazialize/oasis/commit/94b9305059cc104ca404f2cd2f23381371c39795), [`c63b61d`](https://github.com/Lazialize/oasis/commit/c63b61de70ce852d8182c0a4ec3ecf6af0a0aad2), [`af3e6d7`](https://github.com/Lazialize/oasis/commit/af3e6d78df2b1b9495312e9d530f7bb2474247f0), [`2523da0`](https://github.com/Lazialize/oasis/commit/2523da0f92a7c12fe4e5c322f023b13adcee2531), [`0d0ae66`](https://github.com/Lazialize/oasis/commit/0d0ae66e01e4f65ccb03774bc176019ea43651ad), [`1d7a640`](https://github.com/Lazialize/oasis/commit/1d7a6407ebdee9ef25cb5710ef0ede21b752ffa1)]:
  - @oasis/bundler@0.9.0
  - @oasis/core@0.9.0
  - @oasis/linter@0.9.0
  - @oasis/server@0.9.0

## 0.8.4

### Patch Changes

- Updated dependencies [[`8251964`](https://github.com/Lazialize/oasis/commit/8251964082c2e24be03cb2852006b372e9a55153), [`ec5cd99`](https://github.com/Lazialize/oasis/commit/ec5cd99015e984f2bb20ae5435b2ede90a2ba324), [`8872738`](https://github.com/Lazialize/oasis/commit/8872738104cb5569345801648a16c98a14be5b35)]:
  - @oasis/core@0.8.4
  - @oasis/bundler@0.8.4
  - @oasis/linter@0.8.4
  - @oasis/server@0.8.4

## 0.8.3

### Patch Changes

- [#20](https://github.com/Lazialize/oasis/pull/20) [`682a8ab`](https://github.com/Lazialize/oasis/commit/682a8ab448d617fe514597c20ca233352ae0a8ee) Thanks [@Lazialize](https://github.com/Lazialize)! - fix: CLI and LSP behavior fixes ahead of 1.0

  - `oasis lint` on an entry file that cannot be loaded now reports an error and exits 1, instead of silently reporting zero diagnostics and exiting 0
  - `oasis lint` now rejects unknown single-dash flags (e.g. `-format`) like `oasis bundle` already did, and both commands accept a `--` separator for entry paths that start with `-`
  - the LSP server clears published diagnostics when a standalone (non-project) document is closed, instead of leaving them in the Problems panel indefinitely

- Updated dependencies [[`d1d74d9`](https://github.com/Lazialize/oasis/commit/d1d74d9c9162801b8ba1352bf2690ee77d7583fe), [`682a8ab`](https://github.com/Lazialize/oasis/commit/682a8ab448d617fe514597c20ca233352ae0a8ee), [`0a04379`](https://github.com/Lazialize/oasis/commit/0a0437902aeffa9b185642dc347841d6ddc993c1), [`aee8902`](https://github.com/Lazialize/oasis/commit/aee8902abe95fd7ed7fc281f2f71989a1bb0eb02), [`d600ad9`](https://github.com/Lazialize/oasis/commit/d600ad9a5e36c21bf2e0bcb4aaf828f5a46da707)]:
  - @oasis/bundler@0.8.3
  - @oasis/linter@0.8.3
  - @oasis/server@0.8.3
  - @oasis/core@0.8.3

## 0.8.2

### Patch Changes

- [#18](https://github.com/Lazialize/oasis/pull/18) [`717dc99`](https://github.com/Lazialize/oasis/commit/717dc998af059743ea7fd66d574f023005d78faf) Thanks [@Lazialize](https://github.com/Lazialize)! - Fix three CLI bugs: `oasis init` now accepts `-h`/`--help` flags and prints usage; `oasis lint --format` and `oasis bundle --format` now properly report "requires a value" when no value is provided instead of misleading format validation errors.

- Updated dependencies [[`fcda9cb`](https://github.com/Lazialize/oasis/commit/fcda9cb039ba28624e57914f40001e0e4b364c35), [`f5fdd29`](https://github.com/Lazialize/oasis/commit/f5fdd298e78b3604009c2515e47f0416d7f05770), [`efb4404`](https://github.com/Lazialize/oasis/commit/efb4404fc63dd50e1b97e24d12b380888484425b), [`8060414`](https://github.com/Lazialize/oasis/commit/8060414c1f890f599b820dfe93c8c9f94c5b1435), [`6bcb0b4`](https://github.com/Lazialize/oasis/commit/6bcb0b460f048ff9601aeec1f199821280bdaeed), [`bb3a169`](https://github.com/Lazialize/oasis/commit/bb3a169ad6345fa0763b438c6e63341b62cc09d9)]:
  - @oasis/linter@0.8.2
  - @oasis/server@0.8.2
  - @oasis/core@0.8.2
  - @oasis/bundler@0.8.2

## 0.8.1

### Patch Changes

- [#16](https://github.com/Lazialize/oasis/pull/16) [`f76237e`](https://github.com/Lazialize/oasis/commit/f76237e1c577a8c5afae3a608af5dca4259701d5) Thanks [@Lazialize](https://github.com/Lazialize)! - Fix Marketplace and Homebrew tap publishing being skipped on release: the release workflow is
  called as a reusable workflow from the version-and-tag workflow, which did not pass repository
  secrets through, so the `VSCE_PAT` / `HOMEBREW_TAP_TOKEN` checks always saw empty values. The
  caller now uses `secrets: inherit`.
- Updated dependencies []:
  - @oasis/bundler@0.8.1
  - @oasis/core@0.8.1
  - @oasis/linter@0.8.1
  - @oasis/server@0.8.1

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
