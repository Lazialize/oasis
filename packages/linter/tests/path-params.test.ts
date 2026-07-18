import { describe, expect, test } from "bun:test";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function lintFixture(relativePath: string, config = resolveConfig(undefined), configPath?: string) {
  const fs = new NodeFileSystem();
  const entry = `${fixturesRoot}/${relativePath}`;
  const graph = await loadWorkspaceGraph(fs, entry);
  return lint(graph, config, { configPath });
}

describe("paths/params-defined", () => {
  test("flags a path template param with no matching parameter definition", async () => {
    const diagnostics = await lintFixture("path-params/mismatch.yaml");
    const d = diagnostics.find((d) => d.rule === "paths/params-defined");
    expect(d).toBeDefined();
    expect(d?.message).toContain("{id}");
  });

  test("flags a path parameter that is not required", async () => {
    const diagnostics = await lintFixture("path-params/not-required.yaml");
    const d = diagnostics.find((d) => d.rule === "paths/params-defined");
    expect(d).toBeDefined();
    expect(d?.message).toContain("required: true");
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "paths/params-defined")).toBe(false);
  });
});

describe("paths/params-defined: attribution when the path item is $ref'd to another file", () => {
  test("attaches the diagnostic to the entry file's path-template key, not the resolved file (single operation)", async () => {
    const diagnostics = await lintFixture("path-params/external-ref/entry.yaml");
    const d = diagnostics.find((d) => d.rule === "paths/params-defined");
    expect(d).toBeDefined();
    expect(d?.message).toContain("{id}");
    // The diagnostic must point at entry.yaml (which owns the "/pets/{id}" key), not pets.yaml
    // (the resolved Path Item file, which contains neither the template nor "{id}").
    expect(d?.range.filePath).toContain("external-ref/entry.yaml");
    expect(d?.range.filePath).not.toContain("pets.yaml");
    // Ideally the placeholder span itself: line 5 is "  /pets/{id}:" (0-indexed).
    expect(d?.range.start.line).toBe(5);
  });

  test("attaches to the entry file when the resolved path item has no operations", async () => {
    const diagnostics = await lintFixture("path-params/external-ref-no-ops/entry.yaml");
    const d = diagnostics.find((d) => d.rule === "paths/params-defined");
    expect(d).toBeDefined();
    expect(d?.range.filePath).toContain("external-ref-no-ops/entry.yaml");
  });

  test("attaches to the entry file once per operation when the resolved path item has multiple operations", async () => {
    const diagnostics = await lintFixture("path-params/external-ref-multi-op/entry.yaml");
    const relevant = diagnostics.filter((d) => d.rule === "paths/params-defined");
    expect(relevant).toHaveLength(2);
    expect(relevant.every((d) => d.range.filePath.includes("external-ref-multi-op/entry.yaml"))).toBe(true);
  });

  test("an `oasis-disable-next-line` comment above the key in the entry file suppresses the diagnostic", async () => {
    const diagnostics = await lintFixture("path-params/external-ref-suppressed/entry.yaml");
    expect(diagnostics.some((d) => d.rule === "paths/params-defined")).toBe(false);
  });

  test("a lint.overrides rule matching the entry file (not the resolved file) silences the diagnostic", async () => {
    const config = resolveConfig({
      lint: { overrides: [{ files: ["entry.yaml"], rules: { "paths/params-defined": "off" } }] },
    });
    const configPath = `${fixturesRoot}/path-params/external-ref/oasis.config.jsonc`;
    const diagnostics = await lintFixture("path-params/external-ref/entry.yaml", config, configPath);
    expect(diagnostics.some((d) => d.rule === "paths/params-defined")).toBe(false);
  });

  test("a lint.overrides rule matching only the resolved file does NOT silence the diagnostic", async () => {
    const config = resolveConfig({
      lint: { overrides: [{ files: ["pets.yaml"], rules: { "paths/params-defined": "off" } }] },
    });
    const configPath = `${fixturesRoot}/path-params/external-ref/oasis.config.jsonc`;
    const diagnostics = await lintFixture("path-params/external-ref/entry.yaml", config, configPath);
    expect(diagnostics.some((d) => d.rule === "paths/params-defined")).toBe(true);
  });
});
