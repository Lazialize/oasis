# @oasis/core

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
