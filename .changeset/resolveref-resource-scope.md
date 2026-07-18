---
"@oasis/core": patch
---

fix(core): preserve JSON Schema resource scope when `resolveRef` receives a raw string. A raw-string
call previously recovered occurrence context only when accompanied by `refRange`, so it could fall
back to plain document-relative filesystem resolution and silently return a different physical target
than the equivalent `FoundRef` call — escaping the `$id` resource scope the reference was discovered
under. `resolveRef` now matches a raw string against its recorded graph occurrence(s) by value (and
`refRange`, when given) and reuses that occurrence's canonical base whenever it carries an explicit
resource scope. When matching occurrences disagree on scope (e.g. an aliased reference scalar reused
under multiple resource bases) the call now fails explicitly with an "Ambiguous reference" diagnostic
instead of silently picking the first occurrence. Raw strings with no matching occurrence, or matching
only the document's own default (non-`$id`-scoped) base, keep resolving exactly as before (#149).
