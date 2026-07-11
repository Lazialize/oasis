import { startServer } from "./connection.ts";

/** Start the oasis LSP server on stdio. Never resolves under normal operation. */
export function runLspServer(): void {
  startServer();
}
