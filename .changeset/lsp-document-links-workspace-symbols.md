---
"@oasis/server": minor
---

`oasis lsp` gains two capabilities: Document Links, so a `$ref`'s file-path portion (excluding the
`#/...` fragment) is clickable and jumps to the target file, and Workspace Symbols, to search
component definitions and operations (by `operationId`) across every loaded project graph and open
document, deduped when a file belongs to more than one graph.
