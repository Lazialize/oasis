---
"@oasis/server": patch
---

fix: LSP server no longer leaks a pending validation timer or orphans diagnostics when a document
transitions to the ignored route, and config-file detection now recognizes Windows-style
backslash paths so config watch/reload works on Windows
