---
"@oasis/bundler": patch
---

fix(bundler): preserve source order for integer-like mapping keys. Bundling built plain JS objects,
whose integer-index property names (status codes like `"404"`/`"200"`, numeric component/schema
names like `"10"`/`"2"`) JS enumerates in ascending numeric order — silently reordering them in the
output even though the bundler's contract is to keep authored key order. The bundler now records key
insertion order as it builds each map and serializes through an ordered representation (`Map` for
YAML plus a small ordered JSON writer), so integer-like keys retain their source order in both YAML
and JSON output, deterministically across runs.
