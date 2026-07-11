# Oasis

An OpenAPI 3.0 / 3.1 toolkit: **linter**, **multi-file bundler**, and **language server**, with a VS Code extension built on top.

- Position-preserving parser — every diagnostic points at an exact file/line/column, even across `$ref`'d files
- Works with YAML and JSON documents
- Multi-file workspaces: split schemas, parameters, responses — and whole path definitions — into separate files and `$ref` them

## Requirements

[Bun](https://bun.sh) ≥ 1.0.

## Getting started

```sh
bun install
bun test        # run the whole test suite
```

Run the CLI from the repo:

```sh
bun run packages/cli/src/index.ts <command>
# or, via the workspace bin:
bunx oasis <command>
```

### Install / Build from source

To get a single self-contained `oasis` binary (no `bun`/Node required to run it), compile it with
`bun build --compile`:

```sh
bun run build:bin       # -> dist/oasis
./dist/oasis <command>
```

This is also the simplest way to point an editor at a working `oasis lsp` — see the VS Code
extension section below for `oasis.server.path`.

## Commands

### `oasis lint [entry...]`

Lints one or more OpenAPI documents, following `$ref`s across files. Diagnostics in referenced files are attributed to those files.

```sh
oasis lint openapi.yaml
oasis lint openapi.yaml --format json     # machine-readable output
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
exist on disk is surfaced as a warning diagnostic in the normal output rather than a crash; the
other entries still lint. If every declared entry is missing, that's also a usage error.

Exit code is `1` if any error-severity diagnostic is reported, `0` otherwise, `2` on usage/config errors.

#### Built-in rules

| Rule | Default | Checks |
| --- | --- | --- |
| `structure/required-fields` | error | `openapi`, `info.title`, `info.version`, `paths` (or 3.1 `webhooks`/`components`) present |
| `structure/openapi-version` | error | `openapi` is a valid `3.0.x` / `3.1.x` string |
| `structure/field-types` | error | Common objects have the right shapes (paths, operations, parameters, responses, components…) |
| `structure/http-methods` | error | Only valid HTTP verbs / metadata keys under a path item |
| `structure/schema-nullable` | error | 3.0: no `type` arrays / `null` type; 3.1: no `nullable` |
| `no-duplicate-keys` | error | Duplicate mapping keys in YAML/JSON |
| `no-unresolved-ref` | error | Every `$ref` resolves (missing files *and* missing pointers) |
| `no-ref-cycle` | warn | Cross-file reference cycles |
| `operation-operationId` | error | `operationId` present and unique across the workspace |
| `operation-tags` | warn | Operations have at least one tag |
| `operation-description` | warn | Operations have a `description` or `summary` |
| `path-params-defined` | error | `{param}` templates ↔ `in: path` parameters agree; path params are `required` |
| `no-unused-components` | warn | Components nothing references |

Syntax errors are always reported as errors and cannot be disabled.

#### Configuration

Place an `oasis.config.jsonc` at your project root (discovered upward from the working directory, or passed via `--config`):

```jsonc
{
  "lint": {
    "rules": {
      "operation-tags": "off",
      "no-unused-components": "error"
    }
  },
  "entries": ["openapi.yaml"]
}
```

Severities: `"error"` | `"warn"` | `"info"` | `"off"`.

`entries` is an optional list of entry-document paths, relative to the directory containing the
config file. It's consumed by the LSP (see "project mode" below) and by `oasis lint` when run with
no entry arguments (see above); `oasis lint`/`oasis bundle` given an explicit entry on the command
line ignore this field, and `oasis bundle` never reads it (it always takes exactly one entry). An
entry that doesn't exist on disk produces a config warning diagnostic rather than a crash; the
field can be omitted entirely with no change in behavior.

### `oasis bundle <entry>`

Bundles a multi-file document into a single one.

```sh
oasis bundle openapi.yaml                  # YAML to stdout
oasis bundle openapi.yaml -o dist/openapi.json   # format inferred from extension
oasis bundle openapi.yaml --format json
```

- External `$ref`s are lifted into `components/*` and rewritten to `#/components/...`; the same target is lifted once, and name conflicts are resolved deterministically (`User`, `User_2`, …)
- Path Item `$ref`s (`paths: { /users: { $ref: './paths/users.yaml' } }`) are inlined in place — 3.0 has no `components/pathItems`, and the same strategy is used for 3.1 for consistency
- Reference cycles terminate correctly; unresolved refs are kept verbatim with a warning

### `oasis lsp`

Starts the language server on stdio. Normally launched by an editor, not by hand. Capabilities:

- **Diagnostics** — full lint results as you type (debounced), including unsaved buffers and cross-file attribution
- **Go to Definition** — `$ref` → target, across files
- **Hover** — summary of the resolved target (type, properties)
- **Completion** — keys valid at the cursor position (version-aware: 3.0 `nullable` vs 3.1 `const`/`webhooks`…), and `$ref` target suggestions from the whole workspace
- **Document Symbols** — outline of paths/operations/components
- **Find References / Rename** — from a component definition or any `$ref` pointing at it: every `$ref` across the graph, or a cross-file rename of the component and all its references

**Project mode:** an `oasis.config.jsonc` with an `entries` field defines a project — the server
builds a workspace graph per entry and publishes diagnostics for every file in it immediately, no
file needs to be open. More than one project can be loaded at once (e.g. multiple
`oasis.config.jsonc` files in different subdirectories of a monorepo); each is independent, keyed
by its config file's path. Files transitively `$ref`'d from an entry (e.g. a Path Item file like
`paths/pets.yaml` with no top-level `openapi:` key of its own) are treated as members of the owning
entry's graph rather than broken standalone documents: their diagnostics, go-to-definition, hover,
and `$ref` completion all resolve against that graph. Editing a config file reloads that project's
entries and re-lints; deleting one unloads it. Files outside any project graph keep the original
entry-per-open-document behavior.

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
repo (see [Install / Build from source](#install--build-from-source)):

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
```

Design notes and the reasoning behind the architecture live in [DESIGN.md](DESIGN.md).

## Development

```sh
bun test            # all package tests
bunx tsc --noEmit   # typecheck (packages only; the extension has its own tsconfig)
bun run build:bin   # compile the self-contained dist/oasis binary
bun run test:bin    # exercise the compiled binary (lint/bundle/lsp), rebuilding it if missing
```

The VS Code extension is built separately with npm — see [editors/vscode/README.md](editors/vscode/README.md).
