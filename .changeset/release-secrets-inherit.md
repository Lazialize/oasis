---
"@oasis/cli": patch
---

Fix Marketplace and Homebrew tap publishing being skipped on release: the release workflow is
called as a reusable workflow from the version-and-tag workflow, which did not pass repository
secrets through, so the `VSCE_PAT` / `HOMEBREW_TAP_TOKEN` checks always saw empty values. The
caller now uses `secrets: inherit`.
