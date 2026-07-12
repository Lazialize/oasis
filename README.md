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
| `structure/schema-nullable` | error | 3.0: no `type` arrays / `null` type; 3.1: no `nullable` — in every schema, including inline ones |
| `no-duplicate-keys` | error | Duplicate mapping keys in YAML/JSON |
| `no-unresolved-ref` | error | Every `$ref` resolves (missing files *and* missing pointers) |
| `no-ref-cycle` | warn | Cross-file reference cycles |
| `operation-operationId` | error | `operationId` present and unique across the workspace (including 3.1 `webhooks`) |
| `operation-tags` | warn | Operations have at least one tag |
| `operation-description` | warn | Operations have a `description` or `summary` |
| `operation-success-response` | warn | Operations have at least one 2xx/3xx response (`default` alone doesn't count) |
| `path-params-defined` | error | `{param}` templates ↔ `in: path` parameters agree; path params are `required` |
| `no-unused-components` | warn | Components nothing references |
| `no-duplicate-paths` | error | Path templates that are equivalent up to parameter names (`/users/{id}` vs `/users/{userId}`) |
| `security-defined` | error | `security` requirement scheme names exist in `components/securitySchemes` |
| `tags-defined` | off | Operation tags are declared in the root `tags` list |
| `no-unused-tags` | warn | Root `tags` list entries are used by at least one operation |
| `naming-convention` | off | Configurable casing for operationIds, component names, parameter names, schema property names (see below) |
| `example-schema-match` | warn | `example`/`examples[].value` values conform to their schema (Schema Object, Media Type Object, Parameter Object), version-aware |

Operation-level rules (`operation-*`, `security-defined`, `tags-defined`, `naming-convention`,
`example-schema-match`) also cover operations under the root `webhooks` map on 3.1 documents.
Path-shaped rules (`path-params-defined`, `no-duplicate-paths`) apply to `paths` only — webhook
keys are arbitrary names, not URL templates. Schema rules (`structure/schema-nullable`,
`naming-convention` property names, `example-schema-match`) check every schema site: `components`
entries plus inline request/response media types, parameters and headers.

Syntax errors are always reported as errors and cannot be disabled.

##### `example-schema-match` validation subset

This rule hand-rolls a small subset of JSON Schema / OpenAPI Schema Object validation rather than
pulling in a full validator dependency, to keep the binary lean. It checks `type` (version-aware:
3.0 `nullable` vs 3.1 type arrays / `"null"`), `enum`, `const` (3.1), `required`/`properties`,
`additionalProperties: false`, `items` (+ 3.1 `prefixItems`), `minItems`/`maxItems`,
`minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum` (version-aware boolean vs numeric
exclusive bounds), `minLength`/`maxLength`/`pattern`, and `allOf` (every branch must pass) /
`oneOf`/`anyOf` (at least one branch must pass — `oneOf`'s exclusivity is deliberately not
enforced). Schemas using `not`, `discriminator`, or containing an unresolved `$ref` are skipped
entirely (no diagnostic) rather than risk a false positive. `externalValue` examples are skipped
since there's no local value to check.

##### `naming-convention` options

Off by default and a no-op until configured — pass an options object naming at least one target and
the casing style to enforce for it:

```jsonc
{
  "lint": {
    "rules": {
      "naming-convention": [
        "warn",
        {
          "operationId": "camelCase",
          "componentName": "PascalCase",
          "parameterName": "camelCase",
          "propertyName": "camelCase"
        }
      ]
    }
  }
}
```

- All four keys are optional; only the ones present are checked. Supported styles: `camelCase`,
  `PascalCase`, `snake_case`, `kebab-case`, `SCREAMING_SNAKE_CASE`.
- `componentName` checks the keys under every `components/*` group (`schemas`, `responses`,
  `parameters`, `examples`, `requestBodies`, `headers`, `securitySchemes`, `links`, `callbacks`, and
  3.1's `pathItems`).
- `parameterName` checks parameter objects' `name` field, from path items, operations, and
  `components/parameters`. `in: header` parameters are exempt — HTTP header names are conventionally
  kebab/mixed case and case-insensitive on the wire, so enforcing a body/query-style casing on them
  doesn't make sense.
- `propertyName` checks keys directly under a schema's `properties` map, recursing into nested
  schemas reachable via `properties`/`items`/`additionalProperties`/`allOf`/`oneOf`/`anyOf` (so a
  nested object's own `properties` are checked too). 3.1's `patternProperties` is not traversed at
  all — its keys are regexes, not property names.

#### Inline suppression

Individual diagnostics can be suppressed with comments in the YAML source, similar to
`eslint-disable`:

```yaml
paths:
  /pets:
    get:
      # oasis-disable-next-line operation-tags
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

#### Configuration

Place an `oasis.config.jsonc` at your project root (discovered upward from the working directory, or passed via `--config`):

```jsonc
{
  "lint": {
    "rules": {
      "operation-tags": "off",
      "no-unused-components": "error",
      "example-rule": ["warn", { "option": "value" }]
    },
    "overrides": [
      {
        "files": ["paths/**/*.yaml"],
        "rules": { "operation-tags": "off" }
      }
    ]
  },
  "entries": ["openapi.yaml"]
}
```

Severities: `"error"` | `"warn"` | `"info"` | `"off"`. A rule can also be given as
`["severity", { ...options }]` to pass it an options object; rules that support options validate
them and document their shape individually (a config warning is emitted for options an enabled
rule rejects, or that are given for a rule that doesn't take any).

`lint.overrides` applies rule config (either severity form) to files matching a glob, on top of
`lint.rules`. Each `files` glob is matched against the diagnostic's file path relative to the
directory containing the config file — including files reached only via `$ref` from the entry
document, not just the entry itself. Later overrides win over earlier ones for the same rule, and
overrides win over `lint.rules` wherever they match (even flipping a globally `"off"` rule back on,
or vice versa, for just the matching files).

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
manual tagging is needed; a maintainer only needs to merge the Version Packages PR.
