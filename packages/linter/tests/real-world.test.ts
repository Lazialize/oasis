import { describe, expect, test } from "bun:test";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";
import type { LintDiagnostic } from "../src/types.ts";

const fixturesRoot = `${import.meta.dir}/fixtures/real-world`;

async function lintFixture(relativePath: string, configFile?: Parameters<typeof resolveConfig>[0]): Promise<LintDiagnostic[]> {
  const fs = new NodeFileSystem();
  const entry = `${fixturesRoot}/${relativePath}`;
  const graph = await loadWorkspaceGraph(fs, entry);
  const config = resolveConfig(configFile);
  return lint(graph, config);
}

/** Error-severity diagnostics from `structure/*` rules only; style rules (operation/tags, etc.) may legitimately warn. */
function structureErrors(diagnostics: LintDiagnostic[]): LintDiagnostic[] {
  return diagnostics.filter((d) => d.rule.startsWith("structure/") && d.severity === "error");
}

describe("real-world vendored specs", () => {
  // Classic Swagger Petstore examples (OpenAPI 3.0, Apache-2.0) and the OAI learn.openapis.org
  // 3.1 examples (CC-BY-4.0). See fixtures/real-world/ATTRIBUTION.md for exact sources.
  const cases = [
    "vendor/petstore.yaml",
    "vendor/petstore-expanded.yaml",
    "vendor/webhook-example.yaml",
    "vendor/non-oauth-scopes.yaml",
  ];

  for (const relativePath of cases) {
    test(`${relativePath}: lints without throwing and has no structure/* errors`, async () => {
      const diagnostics = await lintFixture(relativePath);
      expect(structureErrors(diagnostics)).toEqual([]);
    });
  }
});

describe("kitchen-sink synthetic specs", () => {
  // Crafted to be fully valid across every structural feature the structure/* rules inspect, so
  // these assert zero diagnostics of any severity.
  test("30/entry.yaml: zero diagnostics", async () => {
    const diagnostics = await lintFixture("kitchen-sink/30/entry.yaml");
    expect(diagnostics).toEqual([]);
  });

  test("31/entry.yaml: zero diagnostics", async () => {
    const diagnostics = await lintFixture("kitchen-sink/31/entry.yaml");
    expect(diagnostics).toEqual([]);
  });
});
