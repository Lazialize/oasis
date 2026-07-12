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

describe("components/no-unused", () => {
  test("flags a schema defined but never referenced", async () => {
    const diagnostics = await lintFixture("unused-components/unused.yaml");
    const d = diagnostics.find((d) => d.rule === "components/no-unused");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warn");
    expect(d?.message).toContain("Orphan");
  });

  test("valid fixture passes (Pet schema is referenced)", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "components/no-unused")).toBe(false);
  });

  test("security scheme used only via root security requirement is not flagged", async () => {
    const diagnostics = await lintFixture("unused-components/security-root.yaml");
    expect(diagnostics.some((d) => d.rule === "components/no-unused")).toBe(false);
  });

  test("security scheme used only via an operation's security requirement is not flagged", async () => {
    const diagnostics = await lintFixture("unused-components/security-operation.yaml");
    expect(diagnostics.some((d) => d.rule === "components/no-unused")).toBe(false);
  });

  test("security scheme used only via a 3.1 webhook operation's security requirement is not flagged", async () => {
    const diagnostics = await lintFixture("unused-components/security-webhook.yaml");
    expect(diagnostics.some((d) => d.rule === "components/no-unused")).toBe(false);
  });

  test("security scheme never referenced by any security requirement is still flagged", async () => {
    const diagnostics = await lintFixture("unused-components/security-unused.yaml");
    const d = diagnostics.find((d) => d.rule === "components/no-unused");
    expect(d).toBeDefined();
    expect(d?.message).toContain("apiKeyAuth");
  });

  test("discriminator mapping using the pointer form marks the schema used", async () => {
    const diagnostics = await lintFixture("unused-components/discriminator-mapping-pointer.yaml");
    expect(diagnostics.some((d) => d.rule === "components/no-unused")).toBe(false);
  });

  test("discriminator mapping using the bare-name shorthand marks the schema used", async () => {
    const diagnostics = await lintFixture("unused-components/discriminator-mapping-bare-name.yaml");
    expect(diagnostics.some((d) => d.rule === "components/no-unused")).toBe(false);
  });
});
