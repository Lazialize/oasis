---
"@oasis/cli": patch
---

fix(cli): classify rendered paths by real parent segments — in-tree names beginning with `..`
(e.g. `..generated`) are kept repo-relative, and an absolute `path.relative` result (Windows
cross-drive) is correctly treated as outside `cwd` (#77).
