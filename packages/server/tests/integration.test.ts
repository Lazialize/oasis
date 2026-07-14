import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

  test("editing an open $ref'd fragment (no openapi key) re-lints the dependent open standalone entry", async () => {
    client = new LspClient();

    const initResult = await client.request("initialize", {
      processId: null,
      rootUri: null,
      capabilities: {},
    });
    expect(initResult.result?.capabilities).toBeDefined();
    client.notify("initialized", {});

    // Standalone mode: no oasis.config.jsonc anywhere, so the entry becomes its own standalone
    // entry (routeDocument -> {kind: "standalone"}) and the fragment -- no top-level `openapi:` key,
    // not owned by any project -- has nowhere of its own to route to (routeDocument -> {kind:
    // "ignored"}) except as a member of the entry's graph.
    const dir = join(tmpdir(), `oasis-lsp-fragment-relint-${Date.now()}`);
    const entryPath = join(dir, "entry.yaml");
    const fragmentPath = join(dir, "fragment.yaml");
    const entryUri = pathToFileURL(entryPath).toString();
    const fragmentUri = pathToFileURL(fragmentPath).toString();

    const entryText = `openapi: 3.1.0
info:
  title: Entry
  version: "1.0.0"
paths:
  /pets:
    $ref: './fragment.yaml'
`;
    const fragmentTextGood = `get:
  operationId: listPets
  tags: [pets]
  description: List pets.
  responses:
    '200':
      description: OK
`;

    // Open the fragment first, then the entry: opening the entry first would race its own debounced
    // validate (which reads the fragment from disk, where it doesn't exist yet, since it's only
    // "open" in the overlay) against the fragment's didOpen, spuriously reporting an unresolved
    // $ref. Opening the fragment first ensures the overlay already has it by the time the entry
    // validates.
    client.notify("textDocument/didOpen", {
      textDocument: { uri: fragmentUri, languageId: "yaml", version: 1, text: fragmentTextGood },
    });
    // The fragment itself gets an (empty) publish since it routes as "ignored".
    await client.waitFor((msg) => msg.method === "textDocument/publishDiagnostics" && msg.params?.uri === fragmentUri, 15000);

    client.notify("textDocument/didOpen", {
      textDocument: { uri: entryUri, languageId: "yaml", version: 1, text: entryText },
    });
    const entryPublish = await client.waitFor(
      (msg) => msg.method === "textDocument/publishDiagnostics" && msg.params?.uri === entryUri,
      15000,
    );
    // Sanity check: the entry resolved the fragment cleanly (no unresolved $ref), so its graph
    // really does include the fragment and `lastGraphFiles` records that membership.
    expect(entryPublish.params.diagnostics).toEqual([]);

    // Edit the open fragment: drop operationId, which the entry's lint (operation/operation-id,
    // error by default) catches. Before the fix, this went unnoticed until entry.yaml itself was
    // next edited, because the fragment routes as "ignored" and no re-validate was scheduled for
    // the entry that depends on it.
    const fragmentTextBad = fragmentTextGood.replace("  operationId: listPets\n", "");
    client.notify("textDocument/didChange", {
      textDocument: { uri: fragmentUri, version: 2 },
      contentChanges: [{ text: fragmentTextBad }],
    });

    // The diagnostic is attributed to the fragment file itself (where the operation lives), but it
    // only gets (re)published as a side effect of re-validating the *entry* whose graph it belongs
    // to -- which is exactly the fix under test: without it, this publish never arrives.
    const publish = await client.waitFor(
      (msg) =>
        msg.method === "textDocument/publishDiagnostics" &&
        msg.params?.uri === fragmentUri &&
        Array.isArray(msg.params?.diagnostics) &&
        msg.params.diagnostics.some((d: { code?: string }) => d.code === "operation/operation-id"),
      15000,
    );
    expect(publish.params.diagnostics.some((d: { code?: string }) => d.code === "operation/operation-id")).toBe(true);
  }, 20000);

  test("closing a standalone (non-project) document clears its published diagnostics", async () => {
    client = new LspClient();

    const initResult = await client.request("initialize", {
      processId: null,
      rootUri: null,
      capabilities: {},
    });
    expect(initResult.result?.capabilities).toBeDefined();
    client.notify("initialized", {});

    // No oasis.config.jsonc anywhere near this file, so routeDocument classifies it as
    // `{ kind: "standalone" }`: its diagnostics only ever exist because the document is open, and
    // only `oasis.config.jsonc` gets a file watcher -- so once it closes there's nothing left to
    // refresh or clear the Problems panel entry unless the server does it on didClose itself.
    const filePath = join(tmpdir(), `oasis-lsp-close-test-${Date.now()}.yaml`);
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
    expect(publish.params.diagnostics.length).toBeGreaterThan(0);

    client.notify("textDocument/didClose", { textDocument: { uri } });

    const cleared = await client.waitFor(
      (msg) => msg.method === "textDocument/publishDiagnostics" && msg.params?.uri === uri,
      15000,
    );
    expect(cleared.params.diagnostics).toEqual([]);
  }, 20000);

  test("closing an unsaved project-member buffer revalidates it from disk (#50)", async () => {
    // On disk everything is clean; the open buffer for the fragment is edited (unsaved) to drop
    // its operationId. Closing that buffer discards the edit, so the server must recompute the
    // project's diagnostics from disk instead of leaving the discarded buffer's error published.
    const dir = mkdtempSync(join(tmpdir(), "oasis-lsp-close-revalidate-"));
    mkdirSync(join(dir, "paths"), { recursive: true });
    const fragmentPath = join(dir, "paths", "pets.yaml");
    const fragmentUri = pathToFileURL(fragmentPath).toString();
    writeFileSync(join(dir, "oasis.config.jsonc"), `{ "entries": ["openapi.yaml"] }`);
    writeFileSync(
      join(dir, "openapi.yaml"),
      `openapi: 3.1.0
info:
  title: Entry
  version: "1.0.0"
paths:
  /pets:
    $ref: './paths/pets.yaml'
`,
    );
    const fragmentTextGood = `get:
  operationId: listPets
  tags: [pets]
  description: List pets.
  responses:
    '200':
      description: OK
`;
    writeFileSync(fragmentPath, fragmentTextGood);

    client = new LspClient();
    const initResult = await client.request("initialize", {
      processId: null,
      rootUri: pathToFileURL(dir).toString(),
      capabilities: {},
    });
    expect(initResult.result?.capabilities).toBeDefined();
    client.notify("initialized", {});

    // Project mode publishes eagerly at startup: the on-disk fragment is clean.
    const initial = await client.waitFor(
      (msg) => msg.method === "textDocument/publishDiagnostics" && msg.params?.uri === fragmentUri,
      15000,
    );
    expect(initial.params.diagnostics).toEqual([]);

    // Open the fragment with unsaved bad content: the missing operationId shows up.
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: fragmentUri,
        languageId: "yaml",
        version: 1,
        text: fragmentTextGood.replace("  operationId: listPets\n", ""),
      },
    });
    await client.waitFor(
      (msg) =>
        msg.method === "textDocument/publishDiagnostics" &&
        msg.params?.uri === fragmentUri &&
        msg.params.diagnostics.some((d: { code?: string }) => d.code === "operation/operation-id"),
      15000,
    );

    // Close the buffer without saving: diagnostics must be recomputed from the (clean) disk file.
    client.notify("textDocument/didClose", { textDocument: { uri: fragmentUri } });
    const afterClose = await client.waitFor(
      (msg) =>
        msg.method === "textDocument/publishDiagnostics" &&
        msg.params?.uri === fragmentUri &&
        !msg.params.diagnostics.some((d: { code?: string }) => d.code === "operation/operation-id"),
      15000,
    );
    expect(afterClose.params.diagnostics).toEqual([]);
  }, 20000);

  test("closing an unsaved oasis.config.jsonc buffer reloads project config from disk (#50)", async () => {
    // On disk the config declares one (bad) entry. The open config buffer is edited (unsaved) to
    // an empty entries list, unloading the project and clearing its diagnostics. Closing that
    // buffer must reload the config from disk and bring the entry's diagnostics back.
    const dir = mkdtempSync(join(tmpdir(), "oasis-lsp-config-close-"));
    const configPath = join(dir, "oasis.config.jsonc");
    const entryUri = pathToFileURL(join(dir, "a.yaml")).toString();
    writeFileSync(configPath, `{ "entries": ["a.yaml"] }`);
    writeFileSync(
      join(dir, "a.yaml"),
      `openapi: 3.1.0
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
`,
    );

    client = new LspClient();
    const initResult = await client.request("initialize", {
      processId: null,
      rootUri: pathToFileURL(dir).toString(),
      capabilities: {},
    });
    expect(initResult.result?.capabilities).toBeDefined();
    client.notify("initialized", {});

    const hasUnresolvedRef = (msg: any): boolean =>
      msg.method === "textDocument/publishDiagnostics" &&
      msg.params?.uri === entryUri &&
      msg.params.diagnostics.some((d: { code?: string }) => d.code === "refs/no-unresolved");

    await client.waitFor(hasUnresolvedRef, 15000);

    // Unsaved config edit drops all entries: the project unloads and a.yaml's diagnostics clear.
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: pathToFileURL(configPath).toString(),
        languageId: "jsonc",
        version: 1,
        text: `{ "entries": [] }`,
      },
    });
    const cleared = await client.waitFor(
      (msg) =>
        msg.method === "textDocument/publishDiagnostics" && msg.params?.uri === entryUri && msg.params.diagnostics.length === 0,
      15000,
    );
    expect(cleared.params.diagnostics).toEqual([]);

    // Closing the unsaved buffer must snap back to the on-disk config: entry linted again.
    client.notify("textDocument/didClose", { textDocument: { uri: pathToFileURL(configPath).toString() } });
    await client.waitFor(hasUnresolvedRef, 15000);
  }, 20000);
});
