import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { bundle } from "../src/index.ts";

describe("Specification Extension payloads stay opaque in special bundler paths (#91)", () => {
  test("root, Paths, Callback, and $ref sibling extensions are copied unchanged", async () => {
    const fs = new InMemoryFileSystem({
      "/v/entry.yaml": [
        "openapi: 3.1.0",
        "info:",
        "  title: Extensions",
        "  version: '1'",
        "  x-meta: { $ref: './opaque.yaml', summary: literal }",
        "x-root: { $ref: './opaque.yaml', schema: { $ref: './opaque.yaml' } }",
        "paths:",
        "  x-routing: { $ref: './opaque.yaml', summary: literal }",
        "  /external:",
        "    $ref: './path.yaml'",
        "    x-meta: { $ref: './opaque.yaml', summary: sibling }",
        "  /events:",
        "    post:",
        "      callbacks:",
        "        onEvent:",
        "          x-routing: { $ref: './opaque.yaml', summary: callback }",
        "      responses:",
        "        x-meta: { $ref: './opaque.yaml', summary: response }",
        "webhooks:",
        "  x-hook: { $ref: './webhook.yaml' }",
        "components:",
        "  pathItems:",
        "    x-path-item: { $ref: './component-path.yaml' }",
        "  schemas:",
        "    Wrapped:",
        "      $ref: './schema.yaml#/Real'",
        "      x-meta: { $ref: './opaque.yaml', summary: schema-sibling }",
        "    WithDependencies:",
        "      type: object",
        "      dependentSchemas:",
        "        x-dependent: { $ref: './dependent.yaml#/Dep' }",
      ].join("\n"),
      "/v/path.yaml": "get: { operationId: externalPath, responses: { '200': { description: OK } } }\n",
      "/v/schema.yaml": "Real: { type: string }\n",
      "/v/webhook.yaml": "post: { operationId: xWebhook, responses: { '200': { description: OK } } }\n",
      "/v/component-path.yaml": "get: { operationId: xComponentPath, responses: { '200': { description: OK } } }\n",
      "/v/dependent.yaml": "Dep: { type: boolean }\n",
    });
    const graph = await loadWorkspaceGraph(fs, "/v/entry.yaml");

    expect([...graph.documents.keys()].sort()).toEqual([
      "/v/component-path.yaml",
      "/v/dependent.yaml",
      "/v/entry.yaml",
      "/v/path.yaml",
      "/v/schema.yaml",
      "/v/webhook.yaml",
    ]);

    const result = bundle(graph);
    const doc = parseYaml(result.output) as any;

    expect(result.diagnostics).toEqual([]);
    expect(doc["x-root"]).toEqual({
      $ref: "./opaque.yaml",
      schema: { $ref: "./opaque.yaml" },
    });
    expect(doc.info["x-meta"]).toEqual({ $ref: "./opaque.yaml", summary: "literal" });
    expect(doc.paths["x-routing"]).toEqual({ $ref: "./opaque.yaml", summary: "literal" });
    expect(doc.paths["/external"]["x-meta"]).toEqual({
      $ref: "./opaque.yaml",
      summary: "sibling",
    });
    expect(doc.paths["/events"].post.callbacks.onEvent["x-routing"]).toEqual({
      $ref: "./opaque.yaml",
      summary: "callback",
    });
    expect(doc.paths["/events"].post.responses["x-meta"]).toEqual({
      $ref: "./opaque.yaml",
      summary: "response",
    });
    expect(doc.components.schemas.Wrapped["x-meta"]).toEqual({
      $ref: "./opaque.yaml",
      summary: "schema-sibling",
    });
    expect(result.output).toContain("operationId: externalPath");
    expect(result.output).toContain("operationId: xWebhook");
    expect(result.output).toContain("operationId: xComponentPath");
    expect(result.output).not.toContain("./webhook.yaml");
    expect(result.output).not.toContain("./component-path.yaml");
    expect(doc.components.schemas.WithDependencies.dependentSchemas["x-dependent"].$ref).toMatch(
      /^#\/components\/schemas\//,
    );
    expect(result.output).toContain("#/components/schemas/Real");

    const dereferenced = bundle(graph, { dereference: true });
    const dereferencedDoc = parseYaml(dereferenced.output) as any;
    expect(dereferenced.diagnostics).toEqual([]);
    expect(dereferencedDoc.components.schemas.Wrapped["x-meta"]).toEqual({
      $ref: "./opaque.yaml",
      summary: "schema-sibling",
    });
  });
});
