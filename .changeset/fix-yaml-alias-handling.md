---
"@oasis/core": patch
"@oasis/bundler": patch
---

Fix YAML anchor/alias handling across the core walkers and the bundler. Aliased values (`*anchor`, including `<<` merge-key references) were previously invisible to the parser and bundler: a `$ref` reachable only through an alias was never found, duplicate keys inside an aliased map went undetected, pointer traversal couldn't descend through aliases, and the bundler silently dropped aliased keys (e.g. `Derived: *base`) from its output. Aliases are now resolved to their anchored target (with source ranges preserved) before dispatch, guarded against cyclic/self-referential aliases. Also clamp `offsetAtPosition` so out-of-range line/character positions map to the end of the document/line instead of offset 0.
