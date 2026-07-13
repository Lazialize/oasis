import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLI_ENTRY = `${import.meta.dir}/../../cli/src/index.ts`;

/** Minimal LSP client over Content-Length-framed JSON-RPC, for a black-box smoke test. */
class LspClient {
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private buffer = "";
  private pending: { resolve: (msg: unknown) => void; test: (msg: any) => boolean }[] = [];
  private notifications: unknown[] = [];
  private nextId = 1;

  constructor() {
    this.proc = Bun.spawn(["bun", CLI_ENTRY, "lsp"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    void this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      this.buffer += decoder.decode(value, { stream: true });
      this.drain();
    }
  }

  private drain(): void {
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd);
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) return;
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.slice(bodyStart, bodyStart + length);
      this.buffer = this.buffer.slice(bodyStart + length);
      const msg = JSON.parse(body);
      this.handle(msg);
    }
  }

  private handle(msg: any): void {
    const idx = this.pending.findIndex((p) => p.test(msg));
    if (idx !== -1) {
      const [p] = this.pending.splice(idx, 1);
      p!.resolve(msg);
      return;
    }
    this.notifications.push(msg);
  }

  send(message: unknown): void {
    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
    this.proc.stdin.write(header + body);
  }

  request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    this.send({ jsonrpc: "2.0", id, method, params });
    return this.waitFor((msg) => msg.id === id);
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  waitFor(test: (msg: any) => boolean, timeoutMs = 10000): Promise<any> {
    const already = this.notifications.findIndex(test);
    if (already !== -1) return Promise.resolve(this.notifications.splice(already, 1)[0]);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.pending.findIndex((p) => p.resolve === resolve);
        if (i !== -1) this.pending.splice(i, 1);
        reject(new Error(`Timed out waiting for message matching ${test}`));
      }, timeoutMs);
      this.pending.push({
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        test,
      });
    });
  }

  kill(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

describe("oasis lsp (subprocess smoke test)", () => {
  let client: LspClient | undefined;

  afterEach(() => {
    client?.kill();
    client = undefined;
  });

  test("initialize handshake, then publishDiagnostics on a bad document", async () => {
    client = new LspClient();

    const initResult = await client.request("initialize", {
      processId: null,
      rootUri: null,
      capabilities: {},
    });
    expect(initResult.result?.capabilities).toBeDefined();

    client.notify("initialized", {});

    const filePath = join(tmpdir(), `oasis-lsp-test-${Date.now()}.yaml`);
    const uri = pathToFileURL(filePath).toString();
    const badText = `openapi: 3.1.0
info:
  title: Bad
  version: "1.0.0"
paths:
  /pets:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Missing'
`;

    client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "yaml", version: 1, text: badText },
    });

    const publish = await client.waitFor(
      (msg) => msg.method === "textDocument/publishDiagnostics" && msg.params?.uri === uri,
      15000,
    );

    expect(Array.isArray(publish.params.diagnostics)).toBe(true);
    expect(publish.params.diagnostics.length).toBeGreaterThan(0);
    expect(publish.params.diagnostics.some((d: { code?: string }) => d.code === "refs/no-unresolved")).toBe(true);
  }, 20000);

  test("an exception thrown mid-validate is caught and logged, not crashed on, and the server keeps answering requests", async () => {
    client = new LspClient();

    const initResult = await client.request("initialize", {
      processId: null,
      rootUri: null,
      capabilities: {},
    });
    expect(initResult.result?.capabilities).toBeDefined();
    client.notify("initialized", {});

    // Force a *real* synchronous throw inside the reload-config path (`reloadProjectAtConfigPath`
    // in connection.ts -> `loadProjectAtPath` -> `resolveProjectEntries` in project.ts ->
    // `expandGlobEntry` in @oasis/linter/config.ts), which expands a glob `entries` pattern with
    // `Bun.Glob(...).scanSync({ cwd: configDir, ... })` directly against the real filesystem
    // (deliberately bypassing the overlay FS - see that function's own comment). Opening a document
    // named `oasis.config.jsonc` (so `routeDocument` classifies it as `{ kind: "config" }`) whose
    // *directory* doesn't exist on real disk, but whose content is served entirely from the
    // in-editor overlay (so `readConfigFile` succeeds), makes `scanSync` hit a real ENOENT and throw
    // synchronously out of the async chain. Before the crash-safety fix, `documents.onDidOpen`
    // invoked this as a bare `void handleDocumentEvent(...)` with no `.catch`, so the exception
    // would have escaped as an unhandled rejection and killed the process.
    const missingDir = join(tmpdir(), `oasis-lsp-crash-test-${Date.now()}-does-not-exist`);
    const configPath = join(missingDir, "oasis.config.jsonc");
    const configUri = pathToFileURL(configPath).toString();

    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: configUri,
        languageId: "jsonc",
        version: 1,
        text: JSON.stringify({ entries: ["*.yaml"] }),
      },
    });

    // Give the (now-safe) rejection a moment to be caught and logged rather than crash the process.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(client.proc.killed).toBe(false);
    expect(client.proc.exitCode).toBeNull();

    // The server must still be able to answer a normal request afterwards.
    const filePath = join(tmpdir(), `oasis-lsp-test-survives-${Date.now()}.yaml`);
    const uri = pathToFileURL(filePath).toString();
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: "yaml",
        version: 1,
        text: 'openapi: 3.1.0\ninfo:\n  title: Ok\n  version: "1.0.0"\npaths: {}\n',
      },
    });
    const publish = await client.waitFor(
      (msg) => msg.method === "textDocument/publishDiagnostics" && msg.params?.uri === uri,
      15000,
    );
    expect(Array.isArray(publish.params.diagnostics)).toBe(true);
  }, 20000);
});
