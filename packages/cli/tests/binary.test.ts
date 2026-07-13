import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDocument } from "@oasis/core";

/**
 * Verifies the self-contained `bun build --compile` binary actually works: `oasis lint`,
 * `oasis bundle`, and `oasis lsp` (initialize/didOpen/publishDiagnostics) exercised as a real
 * compiled subprocess, not `bun run src/index.ts`. This is the only place we catch runtime
 * breakage specific to compilation (e.g. vscode-languageserver's dynamic requires).
 *
 * The binary is always rebuilt from the current source into a unique temporary path in suite
 * setup (#34), so these tests never run against a stale `dist/oasis` left over from an earlier
 * build (and never touch `dist/` at all). The build takes well under a second, so this suite is
 * part of the default `bun test` run; `bun run test:bin` runs it in isolation.
 */

const repoRoot = `${import.meta.dir}/../../..`;
const buildDir = mkdtempSync(join(tmpdir(), "oasis-bin-test-"));
const binPath = join(buildDir, "oasis");
const fixturesRoot = `${import.meta.dir}/fixtures`;

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runBinary(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn([binPath, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** Minimal LSP client over Content-Length-framed JSON-RPC, talking to the compiled binary. */
class LspClient {
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private buffer = "";
  private pending: { resolve: (msg: unknown) => void; test: (msg: any) => boolean }[] = [];
  private notifications: unknown[] = [];
  private nextId = 1;

  constructor() {
    this.proc = Bun.spawn([binPath, "lsp"], {
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

  async stderrText(): Promise<string> {
    return new Response(this.proc.stderr).text();
  }

  kill(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

describe("compiled oasis binary", () => {
  beforeAll(async () => {
    // Always rebuild from the current source (same flags as the `build:bin` script, but into a
    // unique temp path): a pre-existing dist/oasis may be stale relative to the source under test.
    const build = Bun.spawn(
      ["bun", "build", "packages/cli/src/index.ts", "--compile", "--minify", `--outfile=${binPath}`],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await build.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(build.stderr).text();
      throw new Error(`binary build failed:\n${stderr}`);
    }
  });

  afterAll(() => {
    rmSync(buildDir, { recursive: true, force: true });
  });

  test("binary exists and is executable", () => {
    expect(existsSync(binPath)).toBe(true);
  });

  describe("lint", () => {
    test("exits 0 on a valid document", async () => {
      const result = await runBinary(["lint", `${fixturesRoot}/valid.yaml`]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No lint issues found.");
    });

    test("exits 1 on an invalid document", async () => {
      const result = await runBinary(["lint", `${fixturesRoot}/invalid.yaml`]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("operation/operation-id");
    });
  });

  describe("bundle", () => {
    test("produces valid YAML with lifted refs", async () => {
      const result = await runBinary(["bundle", `${fixturesRoot}/bundle/entry.yaml`]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("#/components/schemas/Pet");
      expect(result.stdout).not.toContain("shared.yaml");

      const doc = parseDocument(result.stdout, "bundle-output.yaml");
      expect(doc.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    });

    test("--format json produces valid, parseable JSON", async () => {
      const result = await runBinary(["bundle", `${fixturesRoot}/bundle/entry.yaml`, "--format", "json"]);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.openapi).toBe("3.0.3");
      expect(parsed.components.schemas.Pet).toBeDefined();
    });
  });

  describe("lsp", () => {
    let client: LspClient | undefined;

    afterAll(() => {
      client?.kill();
      client = undefined;
    });

    test("initialize handshake, didOpen, publishDiagnostics", async () => {
      client = new LspClient();

      const initResult = await client.request("initialize", {
        processId: null,
        rootUri: null,
        capabilities: {},
      });
      expect(initResult.result?.capabilities).toBeDefined();
      expect(initResult.error).toBeUndefined();

      client.notify("initialized", {});

      const filePath = join(tmpdir(), `oasis-bin-lsp-test-${Date.now()}.yaml`);
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

    test("completion: mid-typing `$ref` in a project-mode fragment file offers targets from the owning graph", async () => {
      const projectRoot = join(repoRoot, "examples", "petstore");
      const fragmentPath = join(projectRoot, "paths", "pets.yaml");
      const fragmentText = readFileSync(fragmentPath, "utf-8");
      // Same edit shape as scenario 6: an in-flight, unclosed relative `$ref` value.
      const partialText = fragmentText.replace(
        "$ref: '../openapi.yaml#/components/schemas/Error'",
        "$ref: '../",
      );
      expect(partialText).not.toBe(fragmentText);

      const projectClient = new LspClient();
      try {
        const initResult = await projectClient.request("initialize", {
          processId: null,
          rootUri: pathToFileURL(projectRoot).toString(),
          capabilities: {},
        });
        expect(initResult.error).toBeUndefined();
        projectClient.notify("initialized", {});

        const uri = pathToFileURL(fragmentPath).toString();
        projectClient.notify("textDocument/didOpen", {
          textDocument: { uri, languageId: "yaml", version: 1, text: partialText },
        });

        // Let the project config load and the fragment be routed as a project member before
        // asking for completions.
        await projectClient.waitFor(
          (msg) => msg.method === "textDocument/publishDiagnostics" && msg.params?.uri === uri,
          15000,
        );

        const lines = partialText.split("\n");
        const lineIdx = lines.findIndex((l) => l.includes("$ref: '../"));
        const position = { line: lineIdx, character: lines[lineIdx]!.length };

        const completion = await projectClient.request("textDocument/completion", {
          textDocument: { uri },
          position,
        });

        expect(completion.error).toBeUndefined();
        const items: any[] = completion.result ?? [];
        expect(items.length).toBeGreaterThan(0);
        const errorItem = items.find((i) => typeof i.label === "string" && i.label.includes("openapi.yaml#/components/schemas/Error"));
        expect(errorItem).toBeDefined();
        expect(errorItem.textEdit).toBeDefined();
        expect(errorItem.textEdit.newText).toContain("openapi.yaml#/components/schemas/Error");
      } finally {
        projectClient.kill();
      }
    }, 20000);

    test("initializationOptions.configFiles eagerly loads a subdirectory project (repo root as rootUri) and publishes diagnostics with nothing open", async () => {
      const petstoreConfigPath = join(repoRoot, "examples", "petstore", "oasis.config.jsonc");
      const petstoreOpenApiPath = join(repoRoot, "examples", "petstore", "openapi.yaml");

      const rootClient = new LspClient();
      try {
        const initResult = await rootClient.request("initialize", {
          processId: null,
          rootUri: pathToFileURL(repoRoot).toString(),
          capabilities: {},
          initializationOptions: { configFiles: [petstoreConfigPath] },
        });
        expect(initResult.error).toBeUndefined();
        rootClient.notify("initialized", {});

        // Nothing is ever opened: the server should eagerly build the petstore project's graph
        // from `initializationOptions.configFiles` (a subdirectory config the root-of-workspace
        // scan alone would miss) and publish diagnostics for its files unprompted.
        const uri = pathToFileURL(petstoreOpenApiPath).toString();
        const publish = await rootClient.waitFor(
          (msg) => msg.method === "textDocument/publishDiagnostics" && msg.params?.uri === uri,
          15000,
        );
        expect(Array.isArray(publish.params.diagnostics)).toBe(true);
      } finally {
        rootClient.kill();
      }
    }, 20000);

    test("no configFiles: opening a subdirectory project's fragment file from the repo root triggers upward discovery", async () => {
      const fragmentPath = join(repoRoot, "examples", "petstore", "paths", "pets.yaml");
      const fragmentText = readFileSync(fragmentPath, "utf-8");

      const rootClient = new LspClient();
      try {
        const initResult = await rootClient.request("initialize", {
          processId: null,
          rootUri: pathToFileURL(repoRoot).toString(),
          capabilities: {},
        });
        expect(initResult.error).toBeUndefined();
        rootClient.notify("initialized", {});

        const uri = pathToFileURL(fragmentPath).toString();
        rootClient.notify("textDocument/didOpen", {
          textDocument: { uri, languageId: "yaml", version: 1, text: fragmentText },
        });

        // The fragment has no top-level `openapi:` key; if upward discovery of
        // examples/petstore/oasis.config.jsonc didn't kick in, the server would either ignore it
        // (project-mode-style) or lint it as a broken standalone entry. Diagnostics arriving with
        // no "Missing required field \"openapi\"" noise confirms it was routed as a project member.
        const publish = await rootClient.waitFor(
          (msg) => msg.method === "textDocument/publishDiagnostics" && msg.params?.uri === uri,
          15000,
        );
        expect(Array.isArray(publish.params.diagnostics)).toBe(true);
        expect(
          publish.params.diagnostics.some((d: { message?: string }) => d.message?.includes('Missing required field "openapi"')),
        ).toBe(false);

        const lines = fragmentText.split("\n");
        const lineIdx = lines.findIndex((l) => l.includes("$ref: '../openapi.yaml#/components/schemas/Error'"));
        const position = { line: lineIdx, character: lines[lineIdx]!.indexOf("'../openapi") + 1 };

        const completion = await rootClient.request("textDocument/completion", {
          textDocument: { uri },
          position,
        });
        expect(completion.error).toBeUndefined();
        const items: any[] = completion.result ?? [];
        expect(items.some((i) => typeof i.label === "string" && i.label.includes("Error"))).toBe(true);
      } finally {
        rootClient.kill();
      }
    }, 20000);
  });
});
