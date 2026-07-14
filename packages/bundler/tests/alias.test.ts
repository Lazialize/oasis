import { describe, expect, test } from "bun:test";
import { allDiagnostics, InMemoryFileSystem, loadWorkspaceGraph, parseDocument } from "@oasis/core";
import { parse as yamlParse } from "yaml";
import { bundle } from "../src/index.ts";

const entryPath = "/virtual/entry.yaml";

async function graphFor(files: Record<string, string>) {
  const fs = new InMemoryFileSystem(files);
  return loadWorkspaceGraph(fs, entryPath);
}

describe("bundle: YAML anchors/aliases", () => {
  test("an aliased component (*base) is not silently dropped from the output", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Base: &base",
      "      type: object",
      "      properties:",
      "        id: { type: string }",
      "    Derived: *base",
    ].join("\n");

    const graph = await graphFor({ [entryPath]: entry });
    const result = bundle(graph);

    const out = yamlParse(result.output) as Record<string, any>;
    expect(out.components.schemas.Derived).toBeDefined();
    expect(out.components.schemas.Derived).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
    });
  });

  test("a $ref that is only reachable through an alias is lifted into the bundle", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "paths:",
      "  /a:",
      "    get: &op",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema:",
      "                $ref: './shared.yaml#/components/schemas/Pet'",
      "  /b:",
      "    get: *op",
    ].join("\n");
    const shared = [
      "components:",
      "  schemas:",
      "    Pet:",
      "      type: object",
      "      properties: { name: { type: string } }",
    ].join("\n");

    const graph = await graphFor({
      [entryPath]: entry,
      "/virtual/shared.yaml": shared,
    });
    const result = bundle(graph);

    // The alias-reached $ref resolves cleanly (no unresolved-ref diagnostics).
    expect(result.diagnostics.filter((d) => d.code === "no-unresolved-ref")).toEqual([]);
    const out = yamlParse(result.output) as Record<string, any>;
    // Pet lifted into components; both /a and /b reference it internally.
    expect(out.components.schemas.Pet).toBeDefined();
    expect(result.output).not.toContain("shared.yaml");
    // The aliased path item /b is materialized, not dropped.
    expect(out.paths["/b"].get).toBeDefined();
    expect(out.paths["/b"].get.responses["200"].content["application/json"].schema.$ref).toContain("#/components/schemas/Pet");
  });

  test("an aliased named-entry container keeps entry names semantic while bundling", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Source:",
      "      type: object",
      "      properties: &props",
      "        example:",
      "          $ref: './external.yaml#/External'",
      "    Matrix:",
      "      type: object",
      "      properties: *props",
    ].join("\n");
    const external = "External:\n  type: string\n";

    const result = bundle(await graphFor({
      [entryPath]: entry,
      "/virtual/external.yaml": external,
    }));

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "no-unresolved-ref")).toEqual([]);
    expect(result.output).not.toContain("external.yaml");
    const out = yamlParse(result.output) as Record<string, any>;
    expect(out.components.schemas.Source.properties.example.$ref).toMatch(/^#\/components\/schemas\//);
    expect(out.components.schemas.Matrix.properties.example.$ref).toBe(
      out.components.schemas.Source.properties.example.$ref,
    );
  });

  test("an aliased discriminator.mapping map rewrites external references", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Source:",
      "      type: object",
      "      discriminator:",
      "        propertyName: petType",
      "        mapping: &petMapping",
      "          dog: &dogUri './dog.yaml#/Dog'",
      "    Matrix:",
      "      type: object",
      "      discriminator:",
      "        propertyName: petType",
      "        mapping: *petMapping",
      "    ScalarAlias:",
      "      type: object",
      "      discriminator:",
      "        propertyName: petType",
      "        mapping:",
      "          dog: *dogUri",
    ].join("\n");

    const graph = await graphFor({
      [entryPath]: entry,
      "/virtual/dog.yaml": "Dog:\n  type: object\n",
    });
    const result = bundle(graph);

    expect(allDiagnostics(graph)).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.output).not.toContain("dog.yaml");
    const out = yamlParse(result.output) as Record<string, any>;
    expect(out.components.schemas.Source.discriminator.mapping.dog).toMatch(/^#\/components\/schemas\//);
    expect(out.components.schemas.Matrix.discriminator.mapping.dog).toBe(
      out.components.schemas.Source.discriminator.mapping.dog,
    );
    expect(out.components.schemas.ScalarAlias.discriminator.mapping.dog).toBe(
      out.components.schemas.Source.discriminator.mapping.dog,
    );
  });

  test("a $ref scalar Alias is rewritten from its anchor target", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Source:",
      "      default: &schemaUri './external.yaml#/External'",
      "    Matrix:",
      "      $ref: *schemaUri",
    ].join("\n");

    const graph = await graphFor({
      [entryPath]: entry,
      "/virtual/external.yaml": "External:\n  type: string\n",
    });
    const result = bundle(graph);

    expect(allDiagnostics(graph)).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    const out = yamlParse(result.output) as Record<string, any>;
    expect(out.components.schemas.Source.default).toBe("./external.yaml#/External");
    expect(out.components.schemas.Matrix.$ref).toMatch(/^#\/components\/schemas\//);
  });

  test("an aliased Schema examples sequence stays literal in bundle output", async () => {
    const entry = [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Source:",
      "      type: array",
      "      default: &values",
      "        - $ref: './ghost.yaml#/Literal'",
      "    Matrix:",
      "      type: array",
      "      examples: *values",
    ].join("\n");

    const graph = await graphFor({ [entryPath]: entry });
    const result = bundle(graph);

    expect(allDiagnostics(graph)).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    const out = yamlParse(result.output) as Record<string, any>;
    expect(out.components.schemas.Source.default[0].$ref).toBe("./ghost.yaml#/Literal");
    expect(out.components.schemas.Matrix.examples[0].$ref).toBe("./ghost.yaml#/Literal");
    expect(out.components.schemas).not.toHaveProperty("Literal");
  });

  test("an aliased root paths map keeps external Path Item refs in Path Item semantics", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "components:",
      "  schemas:",
      "    Source:",
      "      default: &sharedPaths",
      "        /items:",
      "          $ref: './path-item.yaml#/ItemPath'",
      "paths: *sharedPaths",
    ].join("\n");
    const pathItem = [
      "ItemPath:",
      "  get:",
      "    responses:",
      "      '200': { description: ok }",
    ].join("\n");

    const result = bundle(await graphFor({
      [entryPath]: entry,
      "/virtual/path-item.yaml": pathItem,
    }));
    const out = yamlParse(result.output) as Record<string, any>;

    expect(result.diagnostics).toEqual([]);
    expect(out.paths["/items"].get.responses["200"].description).toBe("ok");
    expect(out.components?.schemas?.ItemPath).toBeUndefined();
  });

  test("an aliased Path Item Reference Object is inlined instead of lifted into schemas", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "components:",
      "  schemas:",
      "    Source:",
      "      default: &pathItemRef",
      "        $ref: './path-item.yaml#/ItemPath'",
      "paths:",
      "  /items: *pathItemRef",
    ].join("\n");
    const pathItem = [
      "ItemPath:",
      "  post:",
      "    responses:",
      "      '204': { description: done }",
    ].join("\n");

    const result = bundle(await graphFor({
      [entryPath]: entry,
      "/virtual/path-item.yaml": pathItem,
    }));
    const out = yamlParse(result.output) as Record<string, any>;

    expect(result.diagnostics).toEqual([]);
    expect(out.paths["/items"].post.responses["204"].description).toBe("done");
    expect(out.components?.schemas?.ItemPath).toBeUndefined();
  });

  test("aliased callback maps and callback values retain Path Item semantics", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "components:",
      "  schemas:",
      "    Source:",
      "      default: &callbackObject",
      "        '{$request.body#/url}':",
      "          $ref: './path-item.yaml#/CallbackPath'",
      "      example: &callbacks",
      "        done: *callbackObject",
      "paths:",
      "  /start:",
      "    post:",
      "      callbacks: *callbacks",
      "      responses:",
      "        '202': { description: accepted }",
    ].join("\n");
    const pathItem = [
      "CallbackPath:",
      "  post:",
      "    responses:",
      "      '200': { description: callback ok }",
    ].join("\n");

    const result = bundle(await graphFor({
      [entryPath]: entry,
      "/virtual/path-item.yaml": pathItem,
    }));
    const out = yamlParse(result.output) as Record<string, any>;
    const callback = out.paths["/start"].post.callbacks.done["{$request.body#/url}"];

    expect(result.diagnostics).toEqual([]);
    expect(callback.post.responses["200"].description).toBe("callback ok");
    expect(out.components?.schemas?.CallbackPath).toBeUndefined();
  });

  test("an aliased components section reserves names and is retained in dereference mode", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "paths:",
      "  /user:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema: { $ref: './external.yaml#/User' }",
      "x-schemas: &schemas",
      "  User: { type: string, description: local }",
      "components:",
      "  schemas: *schemas",
    ].join("\n");
    const files = {
      [entryPath]: entry,
      "/virtual/external.yaml": "User: { type: object, description: external }\n",
    };

    const bundled = yamlParse(bundle(await graphFor(files)).output) as Record<string, any>;
    expect(bundled.components.schemas.User.description).toBe("local");
    expect(bundled.components.schemas.User_2.description).toBe("external");
    expect(bundled.paths["/user"].get.responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/User_2",
    );

    const dereferenced = yamlParse(bundle(await graphFor(files), { dereference: true }).output) as Record<string, any>;
    expect(dereferenced.components.schemas.User.description).toBe("local");
    expect(dereferenced.paths["/user"].get.responses["200"].content["application/json"].schema.description).toBe(
      "external",
    );
  });

  test("cyclic alias does not hang the bundler and emits a warning", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Node: &n",
      "      type: object",
      "      properties:",
      "        self: *n",
    ].join("\n");

    const graph = await graphFor({ [entryPath]: entry });
    const result = bundle(graph);
    // Terminates and produces output.
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) => d.code === "cyclic-alias")).toBe(true);
    // Confirm the output re-parses.
    expect(() => parseDocument(result.output, "/virtual/out.yaml")).not.toThrow();
  });
});
