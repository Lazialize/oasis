---
"@oasis/cli": patch
---

Accept the conventional `--stdio` transport flag on `oasis lsp` instead of rejecting it. LSP clients that declare the stdio transport (e.g. the VS Code extension via vscode-languageclient's `TransportKind.stdio`, and the same convention in Neovim/Helix/Emacs) append `--stdio` to the launch command. The server previously treated it as an unexpected argument and exited immediately, so the language server never started and restarting it surfaced an "unexpected argument \"--stdio\"" error. The flag is now a no-op (the server always speaks LSP over stdio).
