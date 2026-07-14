---
"@oasis/cli": patch
---

fix(cli): `oasis lsp` now validates its arguments — `-h`/`--help` prints command help and exits 0
without starting the server, any other argument is rejected with exit code 2, and the bare command
keeps its stdio behavior (#81).
