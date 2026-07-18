---
"@oasis/server": patch
---

Reload LSP projects when workspace folders change. Added roots are scanned and validated, removed
roots have their projects, diagnostics, and cached graphs unloaded, and open documents are rerouted
against the new workspace topology. The VS Code extension also recomputes project mode and
reconciles open-document synchronization after folder additions and removals.
