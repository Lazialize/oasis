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

## Commands

### `oasis lint <entry...>`

Lints one or more OpenAPI documents, following `$ref`s across files. Diagnostics in referenced files are attributed to those files.

```sh
oasis lint openapi.yaml
oasis lint openapi.yaml --format json     # machine-readable output
oasis lint openapi.yaml --config path/to/oasis.config.jsonc
```

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
  }
}
```

Severities: `"error"` | `"warn"` | `"info"` | `"off"`.

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

## VS Code extension

A thin LSP client lives in [`editors/vscode`](editors/vscode/). It activates on YAML/JSON files that declare a top-level `openapi` key and leaves everything else alone. See [its README](editors/vscode/README.md) for setup (development host, packaging a `.vsix`, and pointing it at this repo's CLI without a global install).

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
```

The VS Code extension is built separately with npm — see [editors/vscode/README.md](editors/vscode/README.md).
