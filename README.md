# Oasis

An OpenAPI 3.0 / 3.1 toolkit: **linter**, **multi-file bundler**, and **language server**, with a VS Code extension built on top.

- Position-preserving parser — every diagnostic points at an exact file/line/column, even across `$ref`'d files
- Works with YAML and JSON documents
- Multi-file workspaces: split schemas, parameters, responses — and whole path definitions — into separate files and `$ref` them

## Requirements

[Bun](https://bun.sh) ≥ 1.0 to build from source. The compiled `oasis` binary has no runtime dependency on Bun or Node.

## Install

### Homebrew (macOS/Linux)

```sh
brew install lazialize/oasis/oasis
```

This pulls from the [`Lazialize/homebrew-oasis`](https://github.com/Lazialize/homebrew-oasis) tap,
which the release workflow keeps in sync with the latest GitHub Release.

### Prebuilt binaries

Each [GitHub Release](https://github.com/Lazialize/oasis/releases) publishes self-contained `oasis`
binaries for Linux (x64/arm64), macOS (x64/arm64), and Windows (x64), plus a `SHASUMS256.txt`:

```sh
curl -L -o oasis.tar.gz https://github.com/Lazialize/oasis/releases/latest/download/oasis-linux-x64.tar.gz
tar -xzf oasis.tar.gz
./oasis --help
```

The release workflow also publishes the VS Code extension to the
[Marketplace](https://marketplace.visualstudio.com/items?itemName=lazialize.oasis-vscode) as
**Oasis OpenAPI** — see [VS Code extension](#vs-code-extension) below.

### Build from source

```sh
bun install
bun run build:bin       # -> dist/oasis
./dist/oasis <command>
bun run test:bin        # exercise the compiled binary (lint/bundle/lsp)
```

Or run straight from source without compiling:

```sh
bun run packages/cli/src/index.ts <command>
# or, via the workspace bin:
bunx oasis <command>
```

Building from source is also the simplest way to point an editor at a working `oasis lsp` — see
[VS Code extension](#vs-code-extension) below for `oasis.server.path`.

## Quickstart

```sh
oasis init                                # scaffold oasis.config.jsonc in the current directory
oasis lint openapi.yaml                   # lint one document
oasis lint                                # lint every entry in oasis.config.jsonc
oasis bundle openapi.yaml -o dist/openapi.yaml   # flatten a multi-file document into one
oasis lsp                                 # start the language server on stdio (normally launched by an editor)
```

### `oasis init`

Scaffolds an `oasis.config.jsonc` in the current directory. It scans the working directory (up to
2 levels deep, skipping `node_modules` and hidden directories) for YAML/JSON files whose root has
an `openapi:` key and lists what it finds in the generated `entries`; with no documents found,
`entries` is left as a commented-out placeholder. The generated file also contains an empty
`lint.rules` block with commented example overrides. If an `oasis.config.jsonc` already exists in
the directory, `oasis init` refuses to overwrite it and exits `2`.

### `oasis lint [entry...]`

Lints one or more OpenAPI documents, following `$ref`s across files. Diagnostics in referenced
files are attributed to those files.

```sh
oasis lint openapi.yaml
oasis lint openapi.yaml --format json     # machine-readable output
oasis lint openapi.yaml --format sarif    # SARIF 2.1.0, for GitHub Code Scanning (see below)
oasis lint openapi.yaml --config path/to/oasis.config.jsonc
```

With no entry given, `oasis lint` discovers `oasis.config.jsonc` (upward from the working
directory, or via `--config`) and lints every document listed in its `entries`, resolved relative
to the config file's directory:

```sh
oasis lint     # discovers oasis.config.jsonc and lints its "entries"
```

This fails with a usage error (exit `2`) if no entry is given and no config is found, or if a
config is found but has no (or an empty) `entries` list. An entry listed in `entries` that doesn't
exist on disk — or a glob entry that matches no files — is surfaced as a warning diagnostic in the
normal output rather than a crash; the other entries still lint. If every declared entry yields
nothing, that's also a usage error.

Exit code is `1` if any error-severity diagnostic is reported, `0` otherwise, `2` on usage/config errors.

A bare `--` marks everything after it as positional, so an entry path that happens to look like a
flag (`oasis lint -- --help`) is linted rather than triggering `--help`. An option value that looks
like another flag is rejected (`--config --format` is a usage error, not `--config` set to
`"--format"`); pass it explicitly with `--config=--format` if a path genuinely starts with `-`.

### `oasis bundle <entry>`

Bundles a multi-file document into a single one.

```sh
oasis bundle openapi.yaml                  # YAML to stdout
oasis bundle openapi.yaml -o dist/openapi.json   # format inferred from extension
oasis bundle openapi.yaml --format json
oasis bundle openapi.yaml --dereference
```

- External `$ref`s are lifted into `components/*` and rewritten to `#/components/...`; the same target is lifted once, and name conflicts are resolved deterministically (`User`, `User_2`, …)
- Path Item `$ref`s (`paths: { /users: { $ref: './paths/users.yaml' } }`) are inlined in place — 3.0 has no `components/pathItems`, and the same strategy is used for 3.1 for consistency
- `discriminator.mapping` values that are ref-like strings (file paths / pointers) are rewritten like `$ref`s, and files referenced only from a mapping are loaded; bare component-name mapping values are untouched
- Reference cycles terminate correctly; unresolved refs are kept verbatim with a warning

**`--dereference`**: instead of lifting external `$ref`s into `components/*`, every `$ref` — internal
(`#/components/...`) and external — is replaced in place with a deep copy of its resolved target,
recursively, producing a document with no `$ref`s at all wherever possible. Components that are
only reachable through a (now-inlined) `$ref` are dropped from the output; components not
reachable from anywhere are kept verbatim, and so are entries that turn out to be part of a
reference cycle. A `$ref` cannot be inlined at the point where its expansion would revisit a
target already being expanded (a cycle): that occurrence is left as a `$ref` to a minimal
`components/*` entry kept for the cycle's target, and a warning diagnostic is emitted naming the
cycle. The result: fully self-contained except for reference cycles, which keep minimal
`components` entries.

### `oasis lsp`

Starts the language server on stdio. Normally launched by an editor, not by hand. Capabilities:

- **Diagnostics** — full lint results as you type (debounced), including unsaved buffers and cross-file attribution
- **Go to Definition** — `$ref` → target, across files
- **Hover** — summary of the resolved target (type, properties)
- **Completion** — keys valid at the cursor position (version-aware: 3.0 `nullable` vs 3.1 `const`/`webhooks`…), and `$ref` target suggestions from the whole workspace
- **Document Symbols** — outline of paths/operations/components
- **Find References / Rename** — from a component definition or any `$ref` pointing at it: every `$ref` across the graph, or a cross-file rename of the component and all its references
- **Document Links** — `$ref` file paths are clickable, jumping straight to the target file
- **Workspace Symbols** — search component definitions and operations (by `operationId`) across every loaded project graph and open document

**Project mode:** an `oasis.config.jsonc` with an `entries` field defines a project — the server
builds a workspace graph per entry and publishes diagnostics for every file in it immediately, no
file needs to be open. More than one project can be loaded at once (e.g. multiple
`oasis.config.jsonc` files in different subdirectories of a monorepo); each is independent, keyed
by its config file's path. Files transitively `$ref`'d from an entry (e.g. a Path Item file like
`paths/pets.yaml` with no top-level `openapi:` key of its own) are treated as members of the owning
entry's graph rather than broken standalone documents: their diagnostics, go-to-definition, hover,
and `$ref` completion all resolve against that graph. Editing a config file reloads that project's
entries and re-lints; deleting one unloads it. Editing a config file to invalid JSONC (e.g.
mid-keystroke) keeps the last-good project loaded rather than dropping it, and reports the parse
error as a diagnostic on the config file. Files outside any project graph keep the original
entry-per-open-document behavior.

Inline suppression comments (`# oasis-disable-next-line`, `# oasis-disable-file`) and
`lint.rules`/`lint.overrides` apply identically in the editor as on the command line, including
against unsaved buffers: the server re-scans and re-resolves them from the in-editor content on
every edit, whether that's the linted document itself or the `oasis.config.jsonc` that governs it —
no save required.

Configs are discovered two ways, so this works regardless of the file layout or the client's
capabilities:

- **Eagerly at startup**: the server scans each workspace folder root for `oasis.config.jsonc`, and
  additionally loads any config paths the client passes as `initializationOptions.configFiles`
  (the VSCode extension deep-scans the workspace for these — see below — so a config that lives in
  a subdirectory, like `examples/petstore/oasis.config.jsonc`, is found even though it isn't at a
  workspace folder root).
- **Lazily on open/change**: if an opened or edited document doesn't belong to any already-loaded
  project, the server walks upward from its directory (stopping at the enclosing workspace folder,
  or the filesystem root if none) looking for `oasis.config.jsonc` — the same upward-discovery
  semantics as `oasis lint`/`oasis bundle`. This means project mode also works with LSP clients
  that don't do their own deep workspace scan.

Both mechanisms dedupe by the config file's resolved absolute path, so a config found by both never
loads twice.

## Configuration

Place an `oasis.config.jsonc` at your project root (discovered upward from the working directory, or passed via `--config`):

```jsonc
{
  "lint": {
    "rules": {
      "operation/tags": "off",
      "components/no-unused": "error",
      "style/naming-convention": ["warn", { "operationId": "camelCase" }]
    },
    "overrides": [
      {
        "files": ["paths/**/*.yaml"],
        "rules": { "operation/tags": "off" }
      }
    ]
  },
  "entries": ["openapi.yaml"]
}
```

**Severities**: `"error"` | `"warn"` | `"info"` | `"off"`. A rule can also be given as
`["severity", { ...options }]` to pass it an options object; rules that support options validate
them and document their shape individually on their [reference page](docs/rules/README.md) — a
config warning is emitted for options an enabled rule rejects, or that are given for a rule that
doesn't take any. Only [`style/naming-convention`](docs/rules/style/naming-convention.md) currently
takes options.

**`lint.overrides`** applies rule config (either severity form) to files matching a glob, on top of
`lint.rules`. Each `files` glob is matched against the diagnostic's file path relative to the
directory containing the config file — including files reached only via `$ref` from the entry
document, not just the entry itself. Later overrides win over earlier ones for the same rule, and
overrides win over `lint.rules` wherever they match (even flipping a globally `"off"` rule back on,
or vice versa, for just the matching files).

**`entries`** is an optional list of entry-document paths, relative to the directory containing the
config file. An entry may also be a glob pattern (any string containing `*`, `?`, `[`, or `{`,
e.g. `"apis/**/openapi.yaml"`), expanded against the config file's directory; symlinked
directories are not followed, and hidden (dot) directories and `node_modules` never match. Files
matched by more than one entry — literal or glob — are linted once. `entries` is consumed by the
LSP (see "project mode" above) and by `oasis lint` when run with no entry arguments; `oasis
lint`/`oasis bundle` given an explicit entry on the command line ignore this field, and `oasis
bundle` never reads it (it always takes exactly one entry). A literal entry that doesn't exist on
disk, or a glob that matches no files, produces a config warning diagnostic rather than a crash;
the field can be omitted entirely with no change in behavior.

### Built-in rules

See [**docs/rules/**](docs/rules/README.md) for the full rule reference (one page per rule: what it
checks and why, version notes, options, and good/bad examples). Compact summary:

| Rule | Default | Summary |
| --- | --- | --- |
| [`structure/required-fields`](docs/rules/structure/required-fields.md) | error | `openapi`, `info.title`, `info.version`, `paths`/`webhooks`/`components` present |
| [`structure/openapi-version`](docs/rules/structure/openapi-version.md) | error | `openapi` is a valid `3.0.x` / `3.1.x` string |
| [`structure/field-types`](docs/rules/structure/field-types.md) | error | Common objects have the right shapes |
| [`structure/http-methods`](docs/rules/structure/http-methods.md) | error | Only valid HTTP verbs / metadata keys under a path item |
| [`structure/schema-nullable`](docs/rules/structure/schema-nullable.md) | error | Version-correct nullability (3.0 `nullable` vs 3.1 `type` arrays/`null`) |
| [`structure/schema-keywords`](docs/rules/structure/schema-keywords.md) | error | Schema Object keywords match dialect, types, and internal consistency |
| [`structure/security-schemes`](docs/rules/structure/security-schemes.md) | error | `securitySchemes` entries have a recognized `type` and its required fields |
| [`structure/server-variables`](docs/rules/structure/server-variables.md) | error | Server `variables` agree with `{var}` placeholders in `url` |
| [`structure/encoding`](docs/rules/structure/encoding.md) | error | `encoding` keys match schema properties; field shapes |
| [`structure/xml`](docs/rules/structure/xml.md) | error | Schema `xml` field: allowed keys, types, `namespace` shape |
| [`structure/examples`](docs/rules/structure/examples.md) | error | Example Objects: `value`/`externalValue` exclusivity, known keys only |
| [`structure/discriminator`](docs/rules/structure/discriminator.md) | error | Discriminator Objects: required fields, `mapping` targets, composition |
| [`structure/callbacks`](docs/rules/structure/callbacks.md) | error | Callback Objects: expression keys, mapped operations declare `responses` |
| [`structure/links`](docs/rules/structure/links.md) | error | Link Objects: `operationRef`/`operationId` exclusivity and resolution |
| [`syntax/no-duplicate-keys`](docs/rules/syntax/no-duplicate-keys.md) | error | Duplicate mapping keys in YAML/JSON |
| [`refs/no-unresolved`](docs/rules/refs/no-unresolved.md) | error | Every `$ref` resolves |
| [`refs/no-cycle`](docs/rules/refs/no-cycle.md) | warn | Cross-file reference cycles |
| [`operation/operation-id`](docs/rules/operation/operation-id.md) | error | `operationId` present and unique across the workspace |
| [`operation/tags`](docs/rules/operation/tags.md) | warn | Operations have at least one tag |
| [`operation/description`](docs/rules/operation/description.md) | warn | Operations have a `description` or `summary` |
| [`operation/success-response`](docs/rules/operation/success-response.md) | warn | Operations have at least one 2xx/3xx response |
| [`paths/params-defined`](docs/rules/paths/params-defined.md) | error | `{param}` templates ↔ `in: path` parameters agree |
| [`components/no-unused`](docs/rules/components/no-unused.md) | warn | Components nothing references |
| [`paths/no-duplicates`](docs/rules/paths/no-duplicates.md) | error | Path templates equivalent up to parameter names |
| [`security/defined`](docs/rules/security/defined.md) | error | `security` scheme names exist in `components/securitySchemes`; oauth2 scopes are declared |
| [`tags/defined`](docs/rules/tags/defined.md) | off | Operation tags are declared in the root `tags` list |
| [`tags/no-unused`](docs/rules/tags/no-unused.md) | warn | Root `tags` list entries are used by an operation |
| [`style/naming-convention`](docs/rules/style/naming-convention.md) | off | Configurable casing for ids, component/parameter/property names |
| [`examples/schema-match`](docs/rules/examples/schema-match.md) | warn | `example`/`examples[].value` conforms to its schema |

Operation-level rules also cover operations under the root `webhooks` map on 3.1 documents.
Path-shaped rules (`paths/params-defined`, `paths/no-duplicates`) apply to `paths` only — webhook
keys are arbitrary names, not URL templates. Schema rules check every schema site: `components`
entries plus inline request/response media types, parameters, and headers. Syntax errors are
always reported as errors and cannot be disabled.

### Inline suppression

Individual diagnostics can be suppressed with comments in the YAML source, similar to
`eslint-disable`:

```yaml
paths:
  /pets:
    get:
      # oasis-disable-next-line operation/tags
      operationId: listPets
      responses:
        '200':
          description: OK
```

- `# oasis-disable-next-line <rule> [<rule>...]` suppresses the listed rules for any diagnostic
  whose range starts on the line immediately following the comment. With no rule names, it
  suppresses every rule on that line.
- `# oasis-disable-file <rule> [<rule>...]` suppresses the listed rules (or every rule, with no
  names given) for the whole file. It can be placed anywhere in the file; convention is to put it
  at the top.

Rule names are separated by whitespace and/or commas. Unknown rule names are ignored rather than
treated as errors. Suppression is per-file: a directive in a file reached only via `$ref` only
suppresses diagnostics attributed to that file. Syntax errors are never suppressible. JSON
documents don't support comments, so inline suppression isn't available for them — use
`lint.rules`/`lint.overrides` in `oasis.config.jsonc` instead.

## Output formats

### `--format json`

```jsonc
{
  "diagnostics": [
    {
      "rule": "operation/operation-id",
      "severity": "error",       // "error" | "warn" | "info"
      "message": "operationId \"listPets\" is not unique",
      "file": "paths/pets.yaml", // relative to process.cwd() when inside it, absolute otherwise
      "range": {
        "start": { "line": 4, "character": 6 },  // 0-based, unlike SARIF's 1-based lines/columns
        "end": { "line": 4, "character": 15 }
      }
    }
  ],
  "summary": { "errors": 1, "warnings": 0, "infos": 0 }
}
```

`rule` is either a built-in rule name (see [Built-in rules](#built-in-rules)), `oasis/config`, or
`syntax-error`. `oasis/config` is a reserved id for diagnostics about the configuration or invocation
itself (an unknown rule name in `oasis.config.jsonc`, a declared `entries` path that doesn't exist, …)
rather than about the linted document, and isn't a real rule: it can't be configured or suppressed,
and doesn't appear in the built-in rules table. `syntax-error` is emitted for YAML/JSON parse errors.

Pretty output (the default, no `--format` given) uses the same cwd-relative `file` paths and
`error`/`warn`/`info` severity tokens.

### `--format sarif` — GitHub Code Scanning / Actions

`--format sarif` emits a [SARIF 2.1.0](https://sarifweb.azurewebsites.net/) log on stdout, suitable
for upload to GitHub Code Scanning via
[`github/codeql-action/upload-sarif`](https://github.com/github/codeql-action/tree/main/upload-sarif):

```yaml
name: lint
on: [push, pull_request]
jobs:
  oasis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Download oasis
        run: |
          curl -L -o oasis.tar.gz https://github.com/Lazialize/oasis/releases/latest/download/oasis-linux-x64.tar.gz
          tar -xzf oasis.tar.gz
      - name: Lint (SARIF)
        run: ./oasis lint openapi.yaml --format sarif > oasis.sarif || true
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: oasis.sarif
```

`oasis lint` exits `1` when it finds any error, which would otherwise fail the job before the SARIF
upload step runs. The `|| true` above swallows that exit code so the upload always happens; the
trade-off is that the job goes green even with lint errors; findings surface instead in the repo's
Code Scanning tab (and, on PRs, as annotations). If you'd rather keep the job red on lint errors
while still uploading, replace `|| true` with `continue-on-error: true` on the lint step and add a
separate step afterwards that re-runs `oasis lint` (or checks its exit code) to fail the job.

## VS Code extension

A thin LSP client lives in [`editors/vscode`](editors/vscode/). Without a config file, it
activates on YAML/JSON files that declare a top-level `openapi` key and leaves everything else
alone; if the workspace contains an `oasis.config.jsonc`, it syncs every YAML/JSON/JSONC document
instead and lets the server (in project mode, see above) decide what to do with each one. See
[its README](editors/vscode/README.md) for setup (development host, packaging a `.vsix`, and
pointing it at this repo's CLI without a global install).

The extension launches the server via the `oasis.server.path` / `oasis.server.args` settings
(default: the globally installed `oasis` binary running `lsp`). Instead of installing globally or
running from source, you can point `oasis.server.path` directly at a compiled binary from this
repo (see [Build from source](#build-from-source)):

```jsonc
{
  "oasis.server.path": "/absolute/path/to/oasis/dist/oasis",
  "oasis.server.args": ["lsp"]
}
```

## Project structure

```
packages/
  core/      # parsing with source maps, JSON Pointer ↔ position, $ref resolution, workspace graph
  linter/    # rule engine, built-in rules, config loading
  bundler/   # multi-file bundling
  server/    # LSP server
  cli/       # `oasis` CLI: lint / bundle / lsp
editors/
  vscode/    # VS Code extension (LSP client; npm-managed, outside the Bun workspace)
docs/
  rules/     # per-rule reference pages
```

Design notes and the reasoning behind the architecture live in [DESIGN.md](DESIGN.md).

## Development

```sh
bun test            # all package tests
bunx tsc --noEmit   # typecheck (packages only; the extension has its own tsconfig)
bun run build:bin   # compile the self-contained dist/oasis binary
bun run test:bin    # exercise the compiled binary (lint/bundle/lsp), rebuilding it if missing
bun run bench       # benchmark lint/bundle on synthetic multi-MB/multi-file specs
```

`bun run bench` (`scripts/bench.ts`) generates two deterministic synthetic workloads into a temp
directory — a large single-file spec (hundreds of paths, deep `allOf`/`oneOf` schema chains) and a
100+ file `$ref`-linked workspace — then reports median wall-clock time for parse+graph load, a
full lint, and a bundle. Use it after touching hot paths in `packages/core` or
`packages/linter`'s rule engine to check for regressions on large documents.

The VS Code extension is built separately with npm — see [editors/vscode/README.md](editors/vscode/README.md).

### Releasing

Versioning and changelogs are managed with [Changesets](https://github.com/changesets/changesets).
All `@oasis/*` packages are versioned together as a fixed group, and `editors/vscode`'s version is
kept in sync with them.

When you make a user-facing change, add a changeset describing it:

```sh
bun changeset
```

This is picked up by CI: pushes to `main` open/update a "Version Packages" PR with the version
bumps and changelog entries. Merging that PR triggers the workflow again — since there are no
packages published to npm, it instead creates and pushes a `v<version>` git tag and kicks off
`release.yml`, which builds the CLI binaries and the `.vsix`, and publishes a GitHub Release. No
manual tagging is needed; a maintainer only needs to merge the Version Packages PR. See
[docs/releasing.md](docs/releasing.md) for the release workflow's optional Marketplace/Homebrew
publishing steps and the secrets they require.
