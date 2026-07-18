---
"@oasis/cli": patch
---

fix(extension): include MIT license in packaged VSIX artifacts. The VS Code extension VSIX now contains the repository's LICENSE file, resolved at package time by copying it from the repository root. The CI workflow verifies that the packaged VSIX includes the LICENSE (#82).
