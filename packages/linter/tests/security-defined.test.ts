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

describe("security/defined", () => {
  test("flags an undefined scheme referenced at the document root", async () => {
    const diagnostics = await lintFixture("security/undefined-root.yaml");
    const d = diagnostics.find((d) => d.rule === "security/defined");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.message).toContain("apiKey");
  });

  test("flags an undefined scheme referenced at the operation level", async () => {
    const diagnostics = await lintFixture("security/undefined-operation.yaml");
    const d = diagnostics.find((d) => d.rule === "security/defined");
    expect(d).toBeDefined();
    expect(d?.message).toContain("oauth2");
  });

  test('accepts a defined scheme and an empty "{}" (optional) requirement', async () => {
    const diagnostics = await lintFixture("security/valid.yaml");
    expect(diagnostics.some((d) => d.rule === "security/defined")).toBe(false);
  });

  test("flags a violation in a referenced (non-entry) file", async () => {
    const diagnostics = await lintFixture("security/multifile/entry.yaml");
    const d = diagnostics.find((d) => d.rule === "security/defined");
    expect(d).toBeDefined();
    expect(d?.range.filePath).toBe(`${fixturesRoot}/security/multifile/paths-pets.yaml`);
  });

  test("flags an oauth2 scope not declared by any flow", async () => {
    const diagnostics = await lintFixture("security/scopes-unknown.yaml");
    const d = diagnostics.find((d) => d.rule === "security/defined");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.message).toContain('scope "write:pets"');
    expect(d?.message).toContain('"oauth"');
  });

  test("flags a non-empty scope list on a non-oauth2/openIdConnect scheme", async () => {
    const diagnostics = await lintFixture("security/scopes-on-apikey.yaml");
    const d = diagnostics.find((d) => d.rule === "security/defined");
    expect(d).toBeDefined();
    expect(d?.message).toContain('type "apiKey"');
  });

  test("accepts declared oauth2 scopes (any flow), openIdConnect scopes, and empty scope lists", async () => {
    const diagnostics = await lintFixture("security/scopes-valid.yaml");
    expect(diagnostics.some((d) => d.rule === "security/defined")).toBe(false);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "security/defined")).toBe(false);
  });
});

async function lintFiles(files: Record<string, string>, entry = "/virtual/entry.yaml") {
  const fs = new InMemoryFileSystem(files);
  const graph = await loadWorkspaceGraph(fs, entry);
  return lint(graph, resolveConfig(undefined));
}

describe("security/defined scheme scope resolution (issue #37)", () => {
  test("a same-named scheme in an unrelated referenced file does not satisfy a requirement", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.1.0
info:
  title: Scope
  version: "1.0.0"
security:
  - api_key: []
paths:
  /pets:
    $ref: "./paths.yaml#/pets"
`,
      "/virtual/paths.yaml": `pets:
  get:
    operationId: listPets
    tags: [a]
    description: x
    responses:
      '200':
        description: OK
components:
  securitySchemes:
    api_key:
      type: apiKey
      name: X-Key
      in: header
`,
    });
    const d = diagnostics.find((d) => d.rule === "security/defined");
    expect(d).toBeDefined();
    expect(d?.message).toContain('"api_key"');
    // The diagnostic stays source-ranged to the requirement in the entry document.
    expect(d?.range.filePath).toBe("/virtual/entry.yaml");
  });

  test("a scheme defined in the entry document satisfies requirements in referenced files", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.1.0
info:
  title: Scope
  version: "1.0.0"
paths:
  /pets:
    $ref: "./paths.yaml#/pets"
components:
  securitySchemes:
    api_key:
      type: apiKey
      name: X-Key
      in: header
`,
      "/virtual/paths.yaml": `pets:
  get:
    operationId: listPets
    tags: [a]
    description: x
    security:
      - api_key: []
    responses:
      '200':
        description: OK
`,
    });
    expect(diagnostics.some((d) => d.rule === "security/defined")).toBe(false);
  });
});

describe("security/defined role names on non-OAuth schemes (issue #38)", () => {
  const docWith = (version: string, requirement: string, schemeYaml: string) => `openapi: ${version}
info:
  title: Roles
  version: "1.0.0"
security:
${requirement}
paths: {}
components:
  securitySchemes:
${schemeYaml}
`;

  const apiKeyScheme = `    api_key:
      type: apiKey
      name: X-Key
      in: header`;

  test("3.1 allows role names for an apiKey scheme", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": docWith("3.1.0", "  - api_key: [admin, read]", apiKeyScheme),
    });
    expect(diagnostics.some((d) => d.rule === "security/defined")).toBe(false);
  });

  test("3.1 allows role names for http and mutualTLS schemes", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": docWith(
        "3.1.0",
        "  - bearer: [admin]\n  - mtls: [system]",
        `    bearer:
      type: http
      scheme: bearer
    mtls:
      type: mutualTLS`,
      ),
    });
    expect(diagnostics.some((d) => d.rule === "security/defined")).toBe(false);
  });

  test("3.0 still rejects a non-empty array for an apiKey scheme", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": docWith("3.0.3", "  - api_key: [admin]", apiKeyScheme),
    });
    const d = diagnostics.find((d) => d.rule === "security/defined");
    expect(d).toBeDefined();
    expect(d?.message).toContain('type "apiKey"');
  });

  test("3.1 still validates oauth2 values as declared scopes", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": docWith(
        "3.1.0",
        "  - oauth: [unknown:scope]",
        `    oauth:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://example.com/token
          scopes:
            read:pets: Read pets`,
      ),
    });
    const d = diagnostics.find((d) => d.rule === "security/defined");
    expect(d).toBeDefined();
    expect(d?.message).toContain('scope "unknown:scope"');
  });
});
