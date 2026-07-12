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

describe("operation/operation-id", () => {
  test("flags an operation missing operationId", async () => {
    const diagnostics = await lintFixture("operations/missing-operation-id.yaml");
    const d = diagnostics.find((d) => d.rule === "operation/operation-id");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.range.start.line).toBe(7);
  });

  test("flags a duplicate operationId across two paths", async () => {
    const diagnostics = await lintFixture("operations/duplicate-operation-id.yaml");
    const dupes = diagnostics.filter((d) => d.rule === "operation/operation-id");
    expect(dupes.length).toBeGreaterThanOrEqual(1);
    expect(dupes.some((d) => d.message.includes("Duplicate operationId"))).toBe(true);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "operation/operation-id")).toBe(false);
  });
});

describe("operation/tags", () => {
  test("flags an operation with no tags", async () => {
    const diagnostics = await lintFixture("operations/missing-tags.yaml");
    const d = diagnostics.find((d) => d.rule === "operation/tags");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warn");
    expect(d?.range.start.line).toBe(7);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "operation/tags")).toBe(false);
  });
});

describe("operation/description", () => {
  test("flags an operation with neither description nor summary", async () => {
    const diagnostics = await lintFixture("operations/missing-description.yaml");
    const d = diagnostics.find((d) => d.rule === "operation/description");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warn");
    expect(d?.range.start.line).toBe(7);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "operation/description")).toBe(false);
  });
});
