---
"@oasis/server": patch
---

fix(server): emit syntax-valid completion edits for JSON/JSONC documents. Completion items were
always serialized as YAML, so accepting a key inserted a bare `servers: ` and accepting a `$ref`
target inserted a single-quoted `'#/components/schemas/Pet'` — both invalid JSON. Key completions in
`.json`/`.jsonc` documents now insert double-quoted, escaped keys (`"servers": `) with a leading
comma when a preceding sibling member lacks one, and are only offered where a safe, comma-correct
edit is possible (appending a member; contexts that would need a trailing comma after an unwritten
value offer no edit). Empty `$ref` values now insert a double-quoted target. YAML behavior is
unchanged (#117).
