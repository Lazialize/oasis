import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliEntry = `${import.meta.dir}/../src/index.ts`;

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], options: { cwd?: string } = {}): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", cliEntry, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: options.cwd,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "oasis-cli-init-"));
}

function readConfig(dir: string): string {
  return readFileSync(join(dir, "oasis.config.jsonc"), "utf-8");
}

const OPENAPI_YAML = `openapi: 3.0.3
info:
  title: T
  version: "1.0.0"
paths: {}
`;

describe("oasis init", () => {
  test("creates a valid JSONC config in an empty directory, with a commented-out entries placeholder", async () => {
    const dir = tempDir();
    const result = await runCli(["init"], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Created oasis.config.jsonc");
    expect(result.stdout).toContain("No OpenAPI documents found");
    expect(existsSync(join(dir, "oasis.config.jsonc"))).toBe(true);

    const raw = readConfig(dir);
    expect(raw).toContain('// "entries": ["openapi.yaml"],'); // placeholder is commented out
    expect(raw).toContain('"lint": {');
    expect(raw).toContain('"rules": {');
  });

  test("detects OpenAPI documents up to 2 levels deep and lists them in entries", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "openapi.yaml"), OPENAPI_YAML);
    mkdirSync(join(dir, "apis", "v2"), { recursive: true });
    writeFileSync(join(dir, "apis", "v2", "spec.yaml"), OPENAPI_YAML); // depth 3: not detected
    writeFileSync(join(dir, "apis", "other.json"), JSON.stringify({ openapi: "3.1.0", info: {}, paths: {} }));
    writeFileSync(join(dir, "apis", "not-openapi.yaml"), "foo: bar\n"); // no openapi key
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "pkg", "openapi.yaml"), OPENAPI_YAML); // skipped
    mkdirSync(join(dir, ".hidden"), { recursive: true });
    writeFileSync(join(dir, ".hidden", "openapi.yaml"), OPENAPI_YAML); // skipped

    const result = await runCli(["init"], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Detected 2 OpenAPI documents");

    expect(readConfig(dir)).toContain('"entries": ["apis/other.json", "openapi.yaml"],');
  });

  test("refuses to overwrite an existing config with exit 2", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "oasis.config.jsonc"), "{ /* keep me */ }\n");

    const result = await runCli(["init"], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("already exists");
    expect(readFileSync(join(dir, "oasis.config.jsonc"), "utf-8")).toContain("keep me");
  });

  test("rejects unexpected arguments with exit 2", async () => {
    const result = await runCli(["init", "extra"], { cwd: tempDir() });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unexpected argument");
  });

  test("--help prints usage and exits 0", async () => {
    const result = await runCli(["init", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("oasis init");
    expect(result.stdout).toContain("--help");
  });

  test("-h prints usage and exits 0", async () => {
    const result = await runCli(["init", "-h"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("oasis init");
    expect(result.stdout).toContain("--help");
  });

  test("the generated config is immediately usable by `oasis lint` (no args)", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "openapi.yaml"), OPENAPI_YAML);
    const init = await runCli(["init"], { cwd: dir });
    expect(init.exitCode).toBe(0);

    const lint = await runCli(["lint"], { cwd: dir });
    expect(lint.exitCode).toBe(0);
  });
});
