---
"@oasis/server": patch
---

Fix the LSP server crashing on an unhandled rejection: notification-driven async work (document open/change, debounced validation, initial project load, config file reload) is now run through a `runSafely` wrapper that catches and logs errors via `connection.console.error` instead of letting them escape as unhandled rejections, plus a top-level `unhandledRejection` listener as a last-resort net.
