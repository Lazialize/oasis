import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const fixturesRoot = `${import.meta.dir}/fixtures`;
const cliEntry = `${import.meta.dir}/../src/index.ts`;

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", cliEntry, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("oasis bundle CLI", () => {
  test("stdout mode: prints a self-contained YAML document with lifted refs", async () => {
    const result = await runCli(["bundle", `${fixturesRoot}/bundle/entry.yaml`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("openapi: 3.0.3");
    expect(result.stdout).toContain("#/components/schemas/Pet");
    expect(result.stdout).not.toContain("shared.yaml");
  });

  test("--format json produces JSON on stdout", async () => {
    const result = await runCli(["bundle", `${fixturesRoot}/bundle/entry.yaml`, "--format", "json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.openapi).toBe("3.0.3");
    expect(parsed.components.schemas.Pet).toBeDefined();
  });

  test("-o writes to a file instead of stdout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oasis-bundle-"));
    const outPath = join(dir, "out.yaml");
    try {
      const result = await runCli(["bundle", `${fixturesRoot}/bundle/entry.yaml`, "-o", outPath]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      const content = await readFile(outPath, "utf-8");
      expect(content).toContain("#/components/schemas/Pet");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("format is inferred from the -o extension (.json)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oasis-bundle-"));
    const outPath = join(dir, "out.json");
    try {
      const result = await runCli(["bundle", `${fixturesRoot}/bundle/entry.yaml`, "-o", outPath]);
      expect(result.exitCode).toBe(0);
      const content = await readFile(outPath, "utf-8");
      expect(() => JSON.parse(content)).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("--format overrides extension inference", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oasis-bundle-"));
    const outPath = join(dir, "out.json");
    try {
      const result = await runCli(["bundle", `${fixturesRoot}/bundle/entry.yaml`, "-o", outPath, "--format", "yaml"]);
      expect(result.exitCode).toBe(0);
      const content = await readFile(outPath, "utf-8");
      expect(() => JSON.parse(content)).toThrow();
      expect(content).toContain("openapi: 3.0.3");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("--dereference fully inlines refs, dropping the lifted components section", async () => {
    const result = await runCli(["bundle", `${fixturesRoot}/bundle/entry.yaml`, "--dereference"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("$ref");
    expect(result.stdout).not.toContain("shared.yaml");
    expect(result.stdout).not.toContain("components:");
    expect(result.stdout).toContain("type: object");
  });

  test("--dereference keeps a minimal components entry for a reference cycle and warns", async () => {
    const result = await runCli(["bundle", `${fixturesRoot}/bundle/deref-cycle.yaml`, "--dereference"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("warning:");
    expect(result.stdout).toContain("components:");
    expect(result.stdout).toContain("Node:");
    expect(result.stdout).toContain("#/components/schemas/Node");
  });

  test("exits 2 on usage error (no entry given)", async () => {
    const result = await runCli(["bundle"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("entry file");
  });

  test("exits 2 on a bad --format value", async () => {
    const result = await runCli(["bundle", `${fixturesRoot}/bundle/entry.yaml`, "--format", "xml"]);
    expect(result.exitCode).toBe(2);
  });

  test("exits 2 when --format has no value", async () => {
    const result = await runCli(["bundle", `${fixturesRoot}/bundle/entry.yaml`, "--format"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("requires a value");
  });

  test("preserves an unresolved external ref as a warning, exit 0 (#30)", async () => {
    const bundlerFixtures = `${import.meta.dir}/../../bundler/tests/fixtures`;
    const result = await runCli(["bundle", `${bundlerFixtures}/unresolved/entry.yaml`]);
    // Only an external target is missing; the entry parses fine, so the bundle succeeds.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("openapi: 3.0.3");
    // The unresolved reference is kept verbatim in the output.
    expect(result.stdout).toContain("./missing.yaml#/components/schemas/Foo");
    // ...and reported as a warning on stderr.
    expect(result.stderr).toContain("warning:");
    expect(result.stderr).not.toContain("failed to parse");
  });

  test("exits 2 when the entry document fails to load/parse", async () => {
    const result = await runCli(["bundle", `${fixturesRoot}/does-not-exist.yaml`]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("failed to parse");
  });

  test.each([
    ["scalar.yaml", "just-a-scalar\n"],
    ["sequence.json", '["not", "an", "object"]\n'],
    ["null.yaml", "null\n"],
  ])("rejects a non-object entry on stdout (%s)", async (fileName, source) => {
    const dir = await mkdtemp(join(tmpdir(), "oasis-bundle-non-object-"));
    const entryPath = join(dir, fileName);
    try {
      await Bun.write(entryPath, source);
      const result = await runCli(["bundle", entryPath]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("entry document must be an OpenAPI object");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.each([
    ["scalar.json", '"just-a-scalar"\n'],
    ["sequence.yaml", "- not\n- an\n- object\n"],
    ["null.json", "null\n"],
  ])("does not overwrite --out for a non-object entry (%s)", async (fileName, source) => {
    const dir = await mkdtemp(join(tmpdir(), "oasis-bundle-non-object-"));
    const entryPath = join(dir, fileName);
    const outPath = join(dir, "out.yaml");
    try {
      await Bun.write(entryPath, source);
      await Bun.write(outPath, "existing bundle\n");
      const result = await runCli(["bundle", entryPath, "--out", outPath]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("entry document must be an OpenAPI object");
      expect(await readFile(outPath, "utf-8")).toBe("existing bundle\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not create --out for a non-object entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oasis-bundle-non-object-"));
    const entryPath = join(dir, "scalar.yaml");
    const outPath = join(dir, "out.yaml");
    try {
      await Bun.write(entryPath, "just-a-scalar\n");
      const result = await runCli(["bundle", entryPath, "--out", outPath]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("entry document must be an OpenAPI object");
      expect(await Bun.file(outPath).exists()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("`--` allows bundling an entry whose name starts with a dash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oasis-bundle-dash-"));
    const entryPath = join(dir, "-weird.yaml");
    try {
      await Bun.write(entryPath, await readFile(`${fixturesRoot}/bundle/entry.yaml`, "utf-8"));
      await Bun.write(join(dir, "shared.yaml"), await readFile(`${fixturesRoot}/bundle/shared.yaml`, "utf-8"));
      const result = await runCli(["bundle", "--", entryPath]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("#/components/schemas/Pet");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("`--` protects a positional entry literally named --help from being read as the help flag (#31)", async () => {
    const result = await runCli(["bundle", "--", "--help"]);
    expect(result.stdout).not.toContain("Options:");
    // Treated as an entry path (which doesn't exist) rather than the help flag.
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("failed to parse the entry document");
  });
});
