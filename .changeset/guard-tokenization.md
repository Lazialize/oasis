---
"@oasis/server": patch
---

fix(server): tokenize comments, escapes, and document prefixes in the OpenAPI root-key guard. The
"looks like OpenAPI" guard scanned comment text as mapping content, so `{ # openapi: fake ... }`
(YAML) and `{ // "openapi": "fake" ... }` (JSONC) matched as false positives; conversely, JSON
string escapes were copied rather than decoded (a key spelled with escapes such as
`{"open\u0061pi": ...}` never matched, and an escaped backslash before a closing quote desynced
the scanner), and flow roots preceded by a `---` document marker, `%YAML` directive, or leading
comment lines were missed. The guard now skips YAML/JSONC comments while scanning flow content,
decodes double-quoted JSON string escapes before comparing keys against `openapi`, and skips a
bounded document prefix (blank lines, comment lines, directives, and a `---` marker) before
classifying the root, while staying root-aware. The mirrored guard in the VS Code extension
receives the same fix.
