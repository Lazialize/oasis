# Oasis

OpenAPI 3.0/3.1 toolkit: linter, multi-file bundler, LSP server, and a VS Code extension. Bun workspaces monorepo. Architecture and design constraints: @DESIGN.md. CLI usage and built-in rule docs: README.md.

## Commands

- `bun test` — full suite. Prefer scoping to one package while iterating: `bun test packages/linter`
- `bun run typecheck` — run after a series of code changes
- `bun run oasis <cmd>` — run the CLI from source (`lint`, `bundle`, `lsp`)
- `bun run build:bin` → `dist/oasis` single binary; verify with `bun run test:bin`
- The VS Code extension under `editors/vscode` builds with npm/esbuild, not Bun

## Architecture constraints

- Every parsed value must stay traceable to a source range (file + line/col), including across `$ref`'d files. Never discard positions — lint diagnostics and all LSP features depend on them.
- `packages/core` never prints or exits: it returns values + diagnostics. Unresolved refs are diagnostics, not exceptions.
- All file I/O goes through the `FileSystem` interface so the LSP can feed in-memory (unsaved) buffers.
- Code that inspects schemas must branch on document version: 3.0 (`nullable`) vs 3.1 (JSON Schema 2020-12, `type` arrays, `null` type).

## Conventions

- TypeScript `strict`, ESM; relative imports include the `.ts` extension (Bun style)
- Plain functions + types over classes; small files, named exports
- Tests live in each package's `tests/` dir and use fixture documents (good and bad cases)
- Conventional commit messages (`feat:`, `fix:`, `refactor:`, ...)
