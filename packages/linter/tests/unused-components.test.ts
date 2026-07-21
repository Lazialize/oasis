import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
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

  test("security scheme used through an aliased Security Requirement item is not flagged", async () => {
    const entry = "/virtual/entry.yaml";
    const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
      [entry]: [
        "openapi: 3.0.3",
        "info: { title: t, version: '1' }",
        "x-requirement: &requirement { ApiKey: [] }",
        "security: [*requirement]",
        "paths: {}",
        "components:",
        "  securitySchemes:",
        "    ApiKey: { type: apiKey, in: header, name: X-API-Key }",
      ].join("\n"),
    }), entry);
    const diagnostics = lint(graph, resolveConfig(undefined));

    expect(diagnostics.some((diagnostic) =>
      diagnostic.rule === "components/no-unused" && diagnostic.message.includes("ApiKey")
    )).toBe(false);
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

  test("an aliased Discriminator Object marks its mapped schema used", async () => {
    const entry = "/virtual/entry.yaml";
    const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
      [entry]: [
        "openapi: 3.1.0",
        "info: { title: t, version: '1' }",
        "x-discriminator: &discriminator",
        "  propertyName: kind",
        "  mapping: { dog: Dog }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Animal: { discriminator: *discriminator }",
        "    Dog: { type: object }",
      ].join("\n"),
    }), entry);
    const diagnostics = lint(graph, resolveConfig(undefined));

    expect(diagnostics.some((diagnostic) =>
      diagnostic.rule === "components/no-unused" && diagnostic.message.includes("Dog")
    )).toBe(false);
  });

  test("an aliased Schema Object with a recursive alias terminates and marks its mapped schema used", async () => {
    const entry = "/virtual/entry.yaml";
    const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
      [entry]: [
        "openapi: 3.1.0",
        "info: { title: t, version: '1' }",
        "x-schema: &animal",
        "  x-self: *animal",
        "  discriminator:",
        "    propertyName: kind",
        "    mapping: { dog: Dog }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Animal: *animal",
        "    Dog: { type: object }",
      ].join("\n"),
    }), entry);
    const diagnostics = lint(graph, resolveConfig(undefined));

    expect(diagnostics.some((diagnostic) =>
      diagnostic.rule === "components/no-unused" && diagnostic.message.includes("Dog")
    )).toBe(false);
  });

  test("a component section imported as a Reference Object does not flag its `$ref` key as a component", async () => {
    // Common multi-file layout: the whole `components/schemas` map is pulled in from another file
    // via `{ $ref: './schemas.yaml' }`. The `$ref` key is a reference marker, not a component name,
    // so it must never be reported as an unused component (issue: schemas appear "all unused").
    const fs = new InMemoryFileSystem({
      "/virtual/openapi.yaml": [
        "openapi: 3.1.0",
        "info: { title: t, version: '1' }",
        "paths:",
        "  /p:",
        "    get:",
        "      operationId: gp",
        "      responses:",
        "        '200':",
        "          description: ok",
        "          content:",
        "            application/json:",
        "              schema: { $ref: './schemas.yaml#/Schema' }",
        "components:",
        "  schemas:",
        "    $ref: './schemas.yaml'",
      ].join("\n"),
      "/virtual/schemas.yaml": "Schema: { type: object }\n",
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/openapi.yaml");
    const diagnostics = lint(graph, resolveConfig(undefined));

    expect(diagnostics.some((diagnostic) =>
      diagnostic.rule === "components/no-unused" && diagnostic.message.includes('"$ref"')
    )).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.rule === "components/no-unused")).toBe(false);
  });

  test("a ref-shaped Example value in an external target does not mark a component used", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.1.0",
        "info: { title: t, version: '1' }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Unused: { type: string }",
        "  examples:",
        "    E: { $ref: './example.yaml' }",
      ].join("\n"),
      "/virtual/example.yaml": "value: { $ref: './entry.yaml#/components/schemas/Unused' }",
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const diagnostics = lint(graph, resolveConfig(undefined));

    expect(diagnostics.some((diagnostic) =>
      diagnostic.rule === "components/no-unused" && diagnostic.message.includes("Unused")
    )).toBe(true);
  });
});
