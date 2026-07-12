import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import type { FileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";
import { matchesCase, namingConvention } from "../src/rules/naming-convention.ts";
import type { NamingConventionOptions } from "../src/rules/naming-convention.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;
const ruleList = [namingConvention];

async function lintWithOptions(entry: string, options: NamingConventionOptions, fs: FileSystem = new NodeFileSystem()) {
  const graph = await loadWorkspaceGraph(fs, entry);
  const config = resolveConfig({ lint: { rules: { "naming-convention": ["warn", options] } } }, ruleList);
  return lint(graph, config, {}, ruleList);
}

describe("matchesCase", () => {
  test("camelCase", () => {
    expect(matchesCase("getPetById", "camelCase")).toBe(true);
    expect(matchesCase("pet", "camelCase")).toBe(true);
    expect(matchesCase("GetPetById", "camelCase")).toBe(false);
    expect(matchesCase("get_pet_by_id", "camelCase")).toBe(false);
    expect(matchesCase("get-pet-by-id", "camelCase")).toBe(false);
  });

  test("PascalCase", () => {
    expect(matchesCase("GetPetById", "PascalCase")).toBe(true);
    expect(matchesCase("Pet", "PascalCase")).toBe(true);
    expect(matchesCase("getPetById", "PascalCase")).toBe(false);
    expect(matchesCase("Get_Pet", "PascalCase")).toBe(false);
  });

  test("snake_case", () => {
    expect(matchesCase("get_pet_by_id", "snake_case")).toBe(true);
    expect(matchesCase("pet_2", "snake_case")).toBe(true);
    expect(matchesCase("getPetById", "snake_case")).toBe(false);
    expect(matchesCase("get-pet-by-id", "snake_case")).toBe(false);
    expect(matchesCase("Get_Pet", "snake_case")).toBe(false);
  });

  test("kebab-case", () => {
    expect(matchesCase("get-pet-by-id", "kebab-case")).toBe(true);
    expect(matchesCase("pet-2", "kebab-case")).toBe(true);
    expect(matchesCase("get_pet_by_id", "kebab-case")).toBe(false);
    expect(matchesCase("GetPetById", "kebab-case")).toBe(false);
  });

  test("SCREAMING_SNAKE_CASE", () => {
    expect(matchesCase("GET_PET_BY_ID", "SCREAMING_SNAKE_CASE")).toBe(true);
    expect(matchesCase("PET_2", "SCREAMING_SNAKE_CASE")).toBe(true);
    expect(matchesCase("get_pet_by_id", "SCREAMING_SNAKE_CASE")).toBe(false);
    expect(matchesCase("GetPetById", "SCREAMING_SNAKE_CASE")).toBe(false);
  });

  test("empty string never matches", () => {
    for (const style of ["camelCase", "PascalCase", "snake_case", "kebab-case", "SCREAMING_SNAKE_CASE"] as const) {
      expect(matchesCase("", style)).toBe(false);
    }
  });
});

describe("naming-convention rule", () => {
  const entry = `${fixturesRoot}/naming-convention/mixed.yaml`;

  test("unconfigured (default options {}) reports nothing even for badly-cased names", async () => {
    const graph = await loadWorkspaceGraph(new NodeFileSystem(), entry);
    const config = resolveConfig(undefined, ruleList); // rule defaults to off, empty options
    const diagnostics = lint(graph, config, {}, ruleList);
    expect(diagnostics).toEqual([]);
  });

  test("checks operationId casing", async () => {
    const diagnostics = await lintWithOptions(entry, { operationId: "camelCase" });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('operationId "get_pet_list" is not camelCase');
  });

  test("checks componentName casing", async () => {
    const diagnostics = await lintWithOptions(entry, { componentName: "PascalCase" });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('Component "pet_response" in "components/schemas" is not PascalCase');
  });

  test("checks parameterName casing and skips in: header parameters", async () => {
    const diagnostics = await lintWithOptions(entry, { parameterName: "camelCase" });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('Parameter "pet_id" is not camelCase');
    expect(diagnostics.some((d) => d.message.includes("X-Request-Id"))).toBe(false);
  });

  test("checks propertyName casing directly under `properties`, including nested via additionalProperties", async () => {
    const diagnostics = await lintWithOptions(entry, { propertyName: "camelCase" });
    const messages = diagnostics.map((d) => d.message);
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringContaining('Property "pet_age" is not camelCase'), expect.stringContaining('Property "extra_field" is not camelCase')]),
    );
    expect(messages.some((m) => m.includes('"petName"'))).toBe(false);
    expect(messages.some((m) => m.includes('"nested"'))).toBe(false);
  });

  test("patternProperties (3.1) keys are never treated as property names", async () => {
    const mem = new InMemoryFileSystem({
      "/virtual/entry.yaml": `
openapi: 3.1.0
info:
  title: Naming 3.1
  version: "1.0.0"
paths: {}
components:
  schemas:
    Config:
      type: object
      patternProperties:
        "^x-[A-Z_]+$":
          type: string
`,
    });
    const diagnostics = await lintWithOptions("/virtual/entry.yaml", { propertyName: "camelCase" }, mem);
    expect(diagnostics).toEqual([]);
  });

  test("componentName also checks components/pathItems (3.1)", async () => {
    const mem = new InMemoryFileSystem({
      "/virtual/entry.yaml": `
openapi: 3.1.0
info:
  title: Naming 3.1
  version: "1.0.0"
paths: {}
components:
  pathItems:
    pet_item:
      get:
        operationId: getPet
        responses:
          '200':
            description: OK
`,
    });
    const diagnostics = await lintWithOptions("/virtual/entry.yaml", { componentName: "PascalCase" }, mem);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('Component "pet_item" in "components/pathItems" is not PascalCase');
  });

  test("multi-file attribution: a badly-cased component defined in a $ref'd file is attributed to that file", async () => {
    const mem = new InMemoryFileSystem({
      "/virtual/entry.yaml": `
openapi: 3.0.3
info:
  title: Naming Multi
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: getPets
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: './schemas.yaml#/components/schemas/pet_response'
`,
      "/virtual/schemas.yaml": `
components:
  schemas:
    pet_response:
      type: object
      properties:
        name:
          type: string
`,
    });
    const diagnostics = await lintWithOptions("/virtual/entry.yaml", { componentName: "PascalCase" }, mem);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.range.filePath).toBe("/virtual/schemas.yaml");
  });
});

describe("naming-convention validateOptions", () => {
  test("accepts an empty options object", () => {
    expect(namingConvention.validateOptions?.({})).toBeUndefined();
  });

  test("accepts a fully-populated valid options object", () => {
    expect(
      namingConvention.validateOptions?.({
        operationId: "camelCase",
        componentName: "PascalCase",
        parameterName: "snake_case",
        propertyName: "kebab-case",
      }),
    ).toBeUndefined();
  });

  test("rejects a non-object", () => {
    expect(namingConvention.validateOptions?.("nope")).toBeDefined();
    expect(namingConvention.validateOptions?.(null)).toBeDefined();
    expect(namingConvention.validateOptions?.(["camelCase"])).toBeDefined();
  });

  test("rejects an unknown option key", () => {
    const error = namingConvention.validateOptions?.({ notAKey: "camelCase" });
    expect(error).toContain('unknown option "notAKey"');
  });

  test("rejects a non-string option value", () => {
    const error = namingConvention.validateOptions?.({ operationId: 123 });
    expect(error).toContain('operationId" must be a string');
  });

  test("rejects an invalid casing style name", () => {
    const error = namingConvention.validateOptions?.({ operationId: "screaming-kebab" });
    expect(error).toContain("invalid casing style");
  });

  test("invalid options surface as a config diagnostic (rule:\"config\") instead of throwing", async () => {
    const mem = new InMemoryFileSystem({
      "/virtual/entry.yaml": `
openapi: 3.0.3
info:
  title: Naming
  version: "1.0.0"
paths: {}
`,
    });
    const graph = await loadWorkspaceGraph(mem, "/virtual/entry.yaml");
    const config = resolveConfig({ lint: { rules: { "naming-convention": ["warn", { operationId: "not-a-style" }] } } }, ruleList);
    expect(config.configWarnings.some((w) => w.includes("naming-convention") && w.includes("invalid casing style"))).toBe(true);

    const diagnostics = lint(graph, config, {}, ruleList);
    const configDiag = diagnostics.find((d) => d.rule === "config");
    expect(configDiag).toBeDefined();
    expect(configDiag?.message).toContain("naming-convention");
    // The rule falls back to its default (off, {}) rather than crashing.
    expect(diagnostics.some((d) => d.rule === "naming-convention")).toBe(false);
  });
});
