---
"@oasis/server": patch
---

fix(server): revalidate open standalone entries when a watched file is created. When a file is created that could satisfy an unresolved `$ref` in a currently-open standalone entry (an entry without a project config), the server now revalidates that entry so the unresolved diagnostic is cleared. Previously, the diagnostic would linger until the entry document was edited or reopened. This fix applies to standalone entries only; project-member entries were already handled correctly.
