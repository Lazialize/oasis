---
"@oasis/core": minor
"@oasis/linter": minor
---

Inline lint suppression via YAML comments: `# oasis-disable-next-line <rule...>` suppresses the
listed rules (or all, with no names) for diagnostics on the following line, and
`# oasis-disable-file <rule...>` does the same for the whole file. Suppression is resolved
per-file, so a directive in a file reached only via `$ref` only affects diagnostics attributed to
that file, and it flows through the shared lint engine so `oasis lint` and the LSP server honor it
identically. Syntax errors are never suppressible. JSON documents don't support comments, so this
is YAML-only; `@oasis/core` gains `extractSuppressions`/`isSuppressed` to support it.
