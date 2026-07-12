# Oasis — OpenAPI Toolkit

CLI tool providing **lint**, **multi-file bundling**, and an **LSP server** for OpenAPI documents, plus (later) a VSCode extension built on the LSP.

## Decisions (fixed)

- **Language/Runtime**: TypeScript + Bun (Bun workspaces monorepo)
- **OpenAPI versions**: 3.0.x and 3.1.x (no Swagger 2.0)
- **Formats**: YAML and JSON source documents
- **Lint**: built-in rule set + config file to toggle rules / adjust severity (custom rule plugins are out of scope for now)
- **Milestone order**: core parser → lint → bundle → LSP → VSCode extension

## Architecture

Monorepo with Bun workspaces:

```
packages/
  core/      # parsing, source maps, document model, $ref resolution, workspace graph
  linter/    # rule engine + built-in rules + config
  bundler/   # multi-file bundling into a single document
  server/    # LSP server (vscode-languageserver, stdio)
  cli/       # `oasis` CLI: lint / bundle / lsp
editors/
  vscode/    # VSCode extension (milestone 5)
```

### packages/core (foundation for everything else)

The single most important design constraint: **every value in a parsed document must be traceable back to a source range** (file, line/col start–end). Lint diagnostics, LSP diagnostics, go-to-definition, and hover all depend on this.

- Parse YAML with the `yaml` npm package **retaining the CST/AST** (not just `parse()` output) so nodes carry positions. Parse JSON with a position-preserving parser (e.g. `jsonc-parser` or the `yaml` package which also handles JSON).
- Document model: a tree of nodes where each node knows its JSON Pointer (`/paths/~1users/get`) and its source `Range`. Provide lookups both ways:
  - `nodeAtPointer(doc, pointer)` → node + range
  - `nodeAtPosition(doc, offset|position)` → node + its pointer (needed by LSP)
- `$ref` resolution:
  - Same-document (`#/components/...`) and cross-file (`./shared.yaml#/components/...`) refs.
  - A **workspace graph**: entry document + transitively referenced documents, with cycle detection. Refs resolve lazily; unresolved refs are recorded as diagnostics, not exceptions.
- Version detection (`openapi: 3.0.x` vs `3.1.x`) exposed on the document; downstream code branches on it (3.1 = JSON Schema 2020-12, `type` arrays, `null` type; 3.0 = `nullable`, etc.).
- Core never prints or exits; it returns values + diagnostics. All I/O behind a small `FileSystem` interface so LSP can feed in-memory (unsaved) buffers.

### packages/linter

- Rule interface roughly:
  ```ts
  interface Rule {
    name: string;               // e.g. "operation-operationId"
    defaultSeverity: "error" | "warn" | "info" | "off";
    check(ctx: RuleContext): void;  // ctx exposes the document graph, version, report(pointer|node, message)
  }
  ```
- Diagnostics carry: rule name, severity, message, file, range. Renderers: pretty (colored, default) and JSON (`--format json`).
- Config file `oasis.config.jsonc` (JSONC via `jsonc-parser`) at project root, discovered upward from cwd or passed via `--config`:
  ```jsonc
  {
    "lint": { "rules": { "operation-operationId": "error", "no-unused-components": "off" } }
  }
  ```
- Initial built-in rules (validation-style + style-style):
  - structural validation of the OpenAPI schema itself (required fields, correct types, enum values) — implemented as rules so everything flows through one diagnostics pipeline
  - `no-unresolved-ref`, `no-ref-cycle`
  - `operation-operationId` (present + unique), `operation-tags`, `operation-description`
  - `path-params-defined` (path template params ↔ parameters agreement)
  - `no-unused-components`
  - `no-duplicate-keys` (from parser)

### packages/bundler

- Input: entry document + workspace graph. Output: single document (YAML or JSON, `--format`).
- External `$ref`s are lifted into `components/*` of the output; internal refs rewritten to point there. Name conflicts resolved deterministically (suffix with a counter or path-derived name); collisions where two different targets want the same name must not silently merge.
- Preserve key order where practical; output must be a valid document of the same OpenAPI version.
- **Path Item `$ref`s** (a `$ref` directly under a `paths/<path>` key, e.g. `paths: { /users: { $ref: './paths/users.yaml' } }`, whole-file or fragment) are **inlined in place** rather than lifted into `components/*` — OpenAPI 3.0 has no `components/pathItems` section, so lifting isn't an option there, and inlining is used for 3.1 too for consistency (a Redocly-like, uniform strategy). `$ref`s found *inside* the inlined path item (schemas, parameters, responses, ...) are still lifted the normal way. Chained path-item refs are followed with a depth guard. Optionally lifting path items into `components/pathItems` for 3.1 output was considered for v0.6 and rejected for 1.0: it would add a config surface (which strategy, per-document or global) right before the API freeze for a 3.1-only feature, while inline-in-place already gives uniform 3.0/3.1 behavior and matches Redocly's default. Revisit post-1.0 if there's real demand.

### packages/server (LSP)

- `vscode-languageserver` / `vscode-languageserver-textdocument`, stdio transport, launched as `oasis lsp`.
- Reuses core (in-memory buffers via the `FileSystem` interface) and linter.
- Capabilities (initial): publishDiagnostics (lint on open/change, debounced), completion (keys valid at the cursor's pointer per OpenAPI version + `$ref` target suggestions), definition (`$ref` → target range, cross-file), hover (resolved schema summary at cursor), documentSymbol.

### packages/cli

- `oasis lint <entry...>` — exit 1 on errors, 0 otherwise; `--format pretty|json`; `--config`
- `oasis bundle <entry> [-o out] [--format yaml|json]`
- `oasis lsp` — start LSP on stdio
- Use a lightweight arg parser (e.g. `citty` or hand-rolled); keep startup fast.

### editors/vscode (milestone 5)

- Thin client: activates on YAML/JSON files that look like OpenAPI (detect `openapi:` key), spawns `oasis lsp`, wires `vscode-languageclient`.

## Milestones

1. **M1 core**: scaffold monorepo (Bun workspaces, TypeScript strict, `bun test`), implement core as above with thorough tests (pointer↔range lookups, cross-file refs, cycles, 3.0/3.1 detection).
2. **M2 lint**: rule engine, config loading, built-in rules, `oasis lint` CLI with pretty/JSON output + tests (fixture documents, good and bad).
3. **M3 bundle**: bundler + `oasis bundle` + tests (multi-file fixtures, name conflicts, cycles).
4. **M4 LSP**: server package + `oasis lsp` + tests where feasible (unit-test handlers against in-memory docs).
5. **M5 VSCode**: extension scaffold, client wiring, packaging config.

## Conventions

- TypeScript `strict: true`; ESM throughout; `bun test` for tests.
- No classes where plain functions + types suffice. Small files, named exports.
- Every milestone lands with tests passing via `bun test` at repo root.
- Conventional commit messages (`feat:`, `fix:`, ...).
