import { describe, expect, test } from "bun:test";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function lintFixture(relativePath: string) {
  const fs = new NodeFileSystem();
  const entry = `${fixturesRoot}/${relativePath}`;
  const graph = await loadWorkspaceGraph(fs, entry);
  const config = resolveConfig(undefined);
  return lint(graph, config);
}

describe("structure/required-fields", () => {
  test("flags a missing paths field", async () => {
    const diagnostics = await lintFixture("structure/missing-paths.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/required-fields");
    expect(d).toBeDefined();
    expect(d?.message).toContain("paths");
    expect(d?.range.start.line).toBe(0);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/required-fields")).toBe(false);
  });
});

describe("structure/openapi-version", () => {
  test("flags a non 3.0/3.1 version string", async () => {
    const diagnostics = await lintFixture("structure/bad-version.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/openapi-version");
    expect(d).toBeDefined();
    expect(d?.range.start.line).toBe(0);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/openapi-version")).toBe(false);
  });
});

describe("structure/field-types", () => {
  test("flags a top-level field with the wrong type", async () => {
    const diagnostics = await lintFixture("structure/bad-field-types.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/field-types");
    expect(d).toBeDefined();
    expect(d?.message).toContain("tags");
    expect(d?.range.start.line).toBe(4);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/field-types")).toBe(false);
  });
});

describe("structure/http-methods", () => {
  test("flags an invalid key under a path item", async () => {
    const diagnostics = await lintFixture("structure/bad-method.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/http-methods");
    expect(d).toBeDefined();
    expect(d?.message).toContain("fetch");
    expect(d?.range.start.line).toBe(6);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/http-methods")).toBe(false);
  });
});

describe("structure/schema-nullable", () => {
  test("flags a type array in OpenAPI 3.0", async () => {
    const diagnostics = await lintFixture("structure/schema-nullable-30.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-nullable");
    expect(d).toBeDefined();
    expect(d?.range.start.line).toBe(20);
  });

  test("flags nullable in OpenAPI 3.1", async () => {
    const diagnostics = await lintFixture("structure/schema-nullable-31.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-nullable");
    expect(d).toBeDefined();
    expect(d?.range.start.line).toBe(21);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/schema-nullable")).toBe(false);
  });
});
