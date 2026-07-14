import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectEntryDocuments } from "../src/commands/init.ts";

const cliEntry = `${import.meta.dir}/../src/index.ts`;
const BOM = "\uFEFF";

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

  // Issue #80: `oasis init` used to implement its own, less complete root-detection regex/parse
  // instead of reusing the shared `looksLikeOpenApi` guard, and so missed several valid root
  // forms the parser and LSP already support. `detectEntryDocuments` is exercised directly here
  // (fast, no subprocess) for each supported form; one full `oasis init` run is exercised too as
  // an end-to-end regression check for the originally reported uppercase-extension bug.
  describe("detects every supported OpenAPI root form (issue #80)", () => {
    test("uppercase .JSON extension", async () => {
      const dir = tempDir();
      writeFileSync(join(dir, "SPEC.JSON"), JSON.stringify({ openapi: "3.1.0", info: { title: "T" }, paths: {} }, null, 2));
      expect(await detectEntryDocuments(dir)).toEqual(["SPEC.JSON"]);
    });

    test("UTF-8 BOM before a JSON root object", async () => {
      const dir = tempDir();
      writeFileSync(join(dir, "openapi-bom.json"), BOM + JSON.stringify({ openapi: "3.1.0", info: { title: "T" }, paths: {} }));
      expect(await detectEntryDocuments(dir)).toEqual(["openapi-bom.json"]);
    });

    test("UTF-8 BOM before a YAML root mapping", async () => {
      const dir = tempDir();
      writeFileSync(join(dir, "bom.yaml"), BOM + OPENAPI_YAML);
      expect(await detectEntryDocuments(dir)).toEqual(["bom.yaml"]);
    });

    test("YAML flow mapping", async () => {
      const dir = tempDir();
      writeFileSync(join(dir, "flow.yaml"), `{openapi: 3.1.0, info: {title: T}, paths: {}}\n`);
      expect(await detectEntryDocuments(dir)).toEqual(["flow.yaml"]);
    });

    test("YAML document marker followed by a flow mapping", async () => {
      const dir = tempDir();
      writeFileSync(join(dir, "marked-flow.yaml"), `--- {openapi: 3.1.0, info: {title: T}, paths: {}}\n`);
      expect(await detectEntryDocuments(dir)).toEqual(["marked-flow.yaml"]);
    });

    test("YAML block mapping (baseline)", async () => {
      const dir = tempDir();
      writeFileSync(join(dir, "block.yaml"), OPENAPI_YAML);
      expect(await detectEntryDocuments(dir)).toEqual(["block.yaml"]);
    });

    test("quoted root-level key", async () => {
      const dir = tempDir();
      writeFileSync(join(dir, "quoted-double.yaml"), `"openapi": 3.1.0\ninfo:\n  title: T\npaths: {}\n`);
      writeFileSync(join(dir, "quoted-single.yaml"), `'openapi': 3.1.0\ninfo:\n  title: T\npaths: {}\n`);
      expect(await detectEntryDocuments(dir)).toEqual(["quoted-double.yaml", "quoted-single.yaml"]);
    });

    test("nested `openapi` key (not at document root) is NOT detected", async () => {
      const dir = tempDir();
      writeFileSync(
        join(dir, "nested-components.yaml"),
        `info:\n  title: T\ncomponents:\n  openapi: 3.1.0\npaths: {}\n`,
      );
      writeFileSync(
        join(dir, "nested-paths.json"),
        JSON.stringify({ info: { title: "T" }, paths: { "/x": { openapi: "not-a-root-key" } } }),
      );
      expect(await detectEntryDocuments(dir)).toEqual([]);
    });

    test("non-OpenAPI JSON/YAML files are NOT detected", async () => {
      const dir = tempDir();
      writeFileSync(join(dir, "plain.yaml"), "foo: bar\n");
      writeFileSync(join(dir, "plain.json"), JSON.stringify({ foo: "bar" }));
      expect(await detectEntryDocuments(dir)).toEqual([]);
    });

    test("end-to-end: `oasis init` picks up an uppercase .JSON entry", async () => {
      const dir = tempDir();
      writeFileSync(join(dir, "SPEC.JSON"), JSON.stringify({ openapi: "3.1.0", info: { title: "T" }, paths: {} }));

      const result = await runCli(["init"], { cwd: dir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Detected 1 OpenAPI document");
      expect(readConfig(dir)).toContain('"entries": ["SPEC.JSON"],');
    });
  });
});
