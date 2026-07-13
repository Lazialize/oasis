---
"@oasis/cli": patch
---

fix: `oasis lint`/`oasis bundle` argument parsing now respects `--` and rejects flag-looking option values (#31)

- `--` now protects everything after it from being read as `-h`/`--help`, so a positional entry literally named `--help` is linted/bundled instead of printing help and exiting 0
- An option that requires a value (`--config`, `--format`, `-o`/`--out`) now fails with a usage error when the next token is another recognized flag, instead of silently consuming it as the value
- Added a `--flag=value` form as an explicit escape hatch for passing a dash-prefixed value
