---
"@oasis/server": patch
---

perf(server): lazy-load all workspace graphs only for `components/no-unused` code action. Previously, every code-action request eagerly loaded all project entry graphs to check for cross-entry references, even for simple operation ID/description/parameter fixes and extract/inline refactorings that only need the current document's graph. This added unnecessary I/O and latency. Now, all graphs are loaded only when the `components/no-unused` destructive quick fix is offered, keeping routine editor requests fast.
