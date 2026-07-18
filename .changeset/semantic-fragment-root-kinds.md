---
"@oasis/server": patch
---

fix(server): infer whole-document OpenAPI fragment kinds from their incoming `$ref` contexts. Root
completion and hover now recognize Schema, Path Item, Response, and Parameter Object files even
when their contents are empty or lack discriminating keys, while preserving OpenAPI 3.0 versus 3.1
Schema Object completions.
