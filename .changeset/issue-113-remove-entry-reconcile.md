---
"@oasis/server": patch
---

fix(server): reconcile open documents and pending validations when project entries are removed. An
entry dropped from `entries` (config edit or a watched-file config change) now has its pending
debounced validation cancelled so a stale timer can't republish its diagnostics after the clear, and
a still-open removed entry is rerouted from its overlay text and validated as standalone if it's
still a root OpenAPI document, instead of being left cleared and unvalidated until it's next edited
or reopened.
