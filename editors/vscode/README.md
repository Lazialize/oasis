# Oasis OpenAPI (VS Code extension)

A thin [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) client
for the `oasis` OpenAPI toolkit. It spawns `oasis lsp` and wires it up to VS Code to provide, for
OpenAPI 3.0/3.1 YAML and JSON documents:

- **Diagnostics** — lint errors/warnings, updated as you type (debounced).
- **Go to Definition** — jump from a `$ref` to its target, including across files.
- **Hover** — a summary of the resolved schema/keyword under the cursor.
- **Completion** — valid keys for the current position (per OpenAPI version) and `$ref` target
  suggestions.
- **Document Symbols** — outline view of paths/operations/components.

## Activation and OpenAPI detection

The extension activates on `yaml`/`json`/`jsonc` documents (`onLanguage:*`) and also on
`workspaceContains:oasis.config.jsonc`, so it starts up as soon as a workspace with a config file
is opened, even before any matching document is opened.

Without an `oasis.config.jsonc` in the workspace, the `oasis` language server treats *every*
document it is asked to open as the entry point of its own OpenAPI workspace graph and lints it
accordingly. That means if the extension synced every YAML/JSON file in a workspace
unconditionally, opening an unrelated YAML/JSON file would immediately produce a `Missing required
field "openapi"` diagnostic. To avoid that, this extension adds a **client-side content guard** in
that case: a document is only opened/synced with the server if its text matches
`/^\s*(['"]?)openapi\1\s*:/m` (YAML) or `/"openapi"\s*:/` (JSON) — i.e. it looks like it declares a
top-level `openapi:` key. Files that don't match are left alone (no diagnostics, no LSP features).
If a file starts out not matching (e.g. a brand-new empty file) but gains an `openapi:` key later,
it is synced in at that point.

**With an `oasis.config.jsonc` present anywhere in the workspace**, the client guard relaxes: every
`yaml`/`json`/`jsonc` document is synced (including `oasis.config.jsonc` itself), and the server
decides what to do with each one — see "project mode" in the [root README](../../README.md#oasis-lsp).
In short: files reachable from a configured `entries` document (like a Path Item fragment file
with no `openapi:` key of its own) get full LSP features via the owning entry's graph; other files
with an `openapi:` key still lint as their own standalone entry; everything else is silently
ignored. The extension also watches `oasis.config.jsonc` for changes and notifies the server via
`workspace/didChangeWatchedFiles` so edits to (or deletion of) a config reload (or unload) that
project.

Detection (`vscode.workspace.findFiles('**/oasis.config.jsonc', ...)`) is a **deep scan**, not
limited to workspace folder roots, so a config nested in a subdirectory of a larger workspace (e.g.
`examples/petstore/oasis.config.jsonc` when the workspace root is the repo root) is still found.
The resulting config paths (capped at 20, `node_modules` excluded) are passed to the server as
`initializationOptions.configFiles` at startup so it can load those projects eagerly, even before
any of their files are opened. The server also has its own independent upward-discovery fallback
(walking up from an opened document's directory) for clients that don't deep-scan, so this works
even beyond the cap or with editors other than VS Code.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `oasis.server.path` | `"oasis"` | Command used to launch the language server. Change this if you haven't installed the `oasis` CLI globally (see below). |
| `oasis.server.args` | `["lsp"]` | Arguments passed to `oasis.server.path`. |
| `oasis.trace.server` | `"off"` | Standard LSP trace level (`off` / `messages` / `verbose`) — useful for debugging server communication in the "Oasis Language Server" output channel. |

Changing any `oasis.server.*` setting restarts the language server automatically. You can also run
**Oasis: Restart Language Server** from the command palette at any time.

## Development

Install dependencies and build:

```sh
cd editors/vscode
npm install
npm run build     # one-off bundle to dist/extension.js
npm run watch      # rebuild on change
npm run typecheck  # tsc --noEmit
```

### Running in the Extension Development Host

Press **F5** in this directory (`editors/vscode/.vscode/launch.json` is already configured) to
launch a new VS Code window with the extension loaded. It runs `npm run watch` as a pre-launch
task, so edits to `src/extension.ts` are picked up on reload (`Cmd+R` / `Ctrl+R` in the dev host).

The extension defaults to launching a globally installed `oasis` binary, which won't exist in this
repo unless you've `npm link`ed or installed the CLI. There are two ways to point the dev host at
this repo's `oasis` without a global install — open the dev host's settings (or add to
`editors/vscode/.vscode/settings.json` for the extension's own workspace):

**Simplest: use the compiled binary.** From the repo root, run `bun run build:bin` to produce
`dist/oasis` (see the [root README](../../README.md#install--build-from-source)), then set:

```jsonc
{
  "oasis.server.path": "<absolute path to repo>/dist/oasis",
  "oasis.server.args": ["lsp"]
}
```

This avoids needing `bun` on the launched process's PATH and starts faster than running from
source. Re-run `bun run build:bin` after pulling server/CLI changes and restart the language server
(**Oasis: Restart Language Server**) to pick them up.

**Alternative: run from source.**

```jsonc
{
  "oasis.server.path": "bun",
  "oasis.server.args": ["<absolute path to repo>/packages/cli/src/index.ts", "lsp"]
}
```

(`oasis.server.path` and `oasis.server.args` are split into a command + argument list, so the
command must be the `bun` executable and the script path becomes the first argument.)

Then open a `.yaml`/`.json` file containing an `openapi:`/`"openapi"` key to see diagnostics,
hover, completion, etc.

### Packaging

```sh
npm run package   # builds and produces oasis-vscode-<version>.vsix via @vscode/vsce
```

This uses the placeholder publisher `lazialize` — replace before publishing to the Marketplace.
