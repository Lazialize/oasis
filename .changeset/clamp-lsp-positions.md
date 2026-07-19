---
"@oasis/core": patch
"@oasis/server": patch
---

fix(core): clamp `offsetAtPosition` to the real document and CRLF line boundaries. Out-of-range LSP positions (a character past the final line, or a line past the last line) previously produced offsets far beyond the source text, and a character past a CRLF-terminated line clamped to the LF byte instead of the position before the `\r\n` sequence. `offsetAtPosition` now takes the document's source text alongside the `LineCounter` so it can bound every result to `[0, text.length]` and detect `\r\n` vs `\n` line terminators when clamping. All server callers (`refs.ts`, `component-target.ts`, `completion.ts`, `code-actions.ts`) pass `doc.text` through accordingly.
