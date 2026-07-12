# Release setup

`.github/workflows/release.yml` runs on every `v*` tag push (and can be invoked with
`workflow_call` from another workflow with a `tag` input). It builds CLI binaries for 5 targets,
packages the VS Code extension as a `.vsix`, creates a GitHub Release with `SHASUMS256.txt`, then
runs two follow-up jobs:

- `publish-extension` — publishes the built `.vsix` to the VS Code Marketplace.
- `update-homebrew-tap` — regenerates and pushes `Formula/oasis.rb` in the
  `Lazialize/homebrew-oasis` tap from the release's binaries.

Both jobs are optional integrations: if their secret isn't configured, the job checks for it in
its first step, emits a `::notice::` explaining what's missing and how to enable it, and skips the
rest of the job (`skip=true` output short-circuits the remaining steps) rather than failing the
release. The CLI binaries and GitHub Release are unaffected either way.

## Required secrets

### `VSCE_PAT`

Personal Access Token for the `lazialize` Marketplace publisher, used by
`npx @vscode/vsce publish --packagePath <vsix>` in the `publish-extension` job.

- Create it from an Azure DevOps organization associated with the `lazialize` publisher
  (Marketplace publishing is managed through Azure DevOps PATs — see the
  [vsce publishing docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)).
- Scope: **Marketplace > Manage** (the minimum scope vsce needs to publish).
- Add it as a repository secret named `VSCE_PAT` (Settings → Secrets and variables → Actions).
- `editors/vscode/package.json` must not have `"private": true` — vsce reads the manifest bundled
  inside the `.vsix` and refuses to publish a private extension regardless of `--packagePath`.

### `HOMEBREW_TAP_TOKEN`

Fine-grained GitHub Personal Access Token used to clone, commit, and push to
`Lazialize/homebrew-oasis` from the `update-homebrew-tap` job.

- Create a fine-grained PAT scoped to the single repository `Lazialize/homebrew-oasis`.
- Permissions: **Contents: Read and write** (that's all the workflow needs — it only writes
  `Formula/oasis.rb`).
- Add it as a repository secret named `HOMEBREW_TAP_TOKEN` in the `oasis` repo (the token targets
  the tap repo, but is stored where the workflow runs).
- The tap repository `Lazialize/homebrew-oasis` must already exist with a `Formula/` directory at
  its root before the first release that exercises this job; the workflow only updates
  `Formula/oasis.rb`, it does not create the repository.

## Formula generation

The formula is generated from `scripts/homebrew/oasis.rb.tmpl` by
`scripts/homebrew/generate-formula.ts`, which fills in the release version and the sha256 of each
platform archive (read from the release job's `SHASUMS256.txt`, published as the `oasis-shasums`
workflow artifact). The generation logic is pure and covered by
`scripts/homebrew/tests/generate-formula.test.ts` (`bun test scripts/homebrew`), so formula changes
are testable without cutting a real release. To preview a formula locally:

```sh
bun run scripts/homebrew/generate-formula.ts \
  --version 1.2.3 \
  --shasums path/to/SHASUMS256.txt
```
