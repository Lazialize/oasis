import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { parse as parseYaml } from "yaml";
import { bundle } from "../src/index.ts";

type OutputFormat = "yaml" | "json";

function parseOutput(output: string, format: OutputFormat): any {
  return format === "json" ? JSON.parse(output) : parseYaml(output);
}

const opaquePayloads = {
  paths: { arbitrary: { $ref: "./shared.yaml#/$defs/Data" } },
  responses: { arbitrary: { $ref: "./shared.yaml#/$defs/Data" } },
  parameters: { arbitrary: { $ref: "./shared.yaml#/$defs/Data" } },
  callbacks: { arbitrary: { $ref: "./shared.yaml#/$defs/Data" } },
  examples: { arbitrary: { $ref: "./shared.yaml#/$defs/Data" } },
};

describe("#179 OpenAPI 3.1 unknown Schema vocabulary payloads stay opaque", () => {
  for (const format of ["yaml", "json"] as const) {
    for (const dereference of [false, true]) {
      test(`${format} output, dereference=${dereference}`, async () => {
        const entry = "/virtual/entry.yaml";
        const fs = new InMemoryFileSystem({
          [entry]: [
            "openapi: 3.1.0",
            "info: { title: Opaque schema vocabulary, version: '1' }",
            "paths: {}",
            "components:",
            "  schemas:",
            "    Custom:",
            "      paths:",
            "        arbitrary: { $ref: './shared.yaml#/$defs/Data' }",
            "      responses:",
            "        arbitrary: { $ref: './shared.yaml#/$defs/Data' }",
            "      parameters:",
            "        arbitrary: { $ref: './shared.yaml#/$defs/Data' }",
            "      callbacks:",
            "        arbitrary: { $ref: './shared.yaml#/$defs/Data' }",
            "      examples:",
            "        arbitrary: { $ref: './shared.yaml#/$defs/Data' }",
            "      properties:",
            "        knownProperty: { $ref: './shared.yaml#/$defs/Data' }",
            "      allOf:",
            "        - { $ref: './shared.yaml#/$defs/Real' }",
            "      $defs:",
            "        KnownDefinition: { $ref: './shared.yaml#/$defs/Data' }",
            "    RefSibling:",
            "      $ref: './shared.yaml#/$defs/Base'",
            "      custom:",
            "        properties:",
            "          arbitrary: { $ref: './shared.yaml#/$defs/Data' }",
            "      properties:",
            "        knownSibling: { $ref: './shared.yaml#/$defs/Data' }",
            "      default: { $ref: './shared.yaml#/$defs/Data' }",
            "      x-meta: { $ref: './shared.yaml#/$defs/Data' }",
            "      discriminator:",
            "        propertyName: kind",
            "        mapping:",
            "          data: './shared.yaml#/$defs/Data'",
          ].join("\n"),
          "/virtual/shared.yaml": [
            "$defs:",
            "  Base: { type: boolean }",
            "  Real: { type: string }",
            "  Data: { type: integer }",
          ].join("\n"),
        });
        const graph = await loadWorkspaceGraph(fs, entry);

        // The genuine applicator refs deliberately pre-load the same external document used by
        // the opaque payloads. Bundling must still ignore the latter even though they are resolvable.
        expect(graph.documents.has("/virtual/shared.yaml")).toBe(true);

        const result = bundle(graph, { format, dereference });
        const schema = parseOutput(result.output, format).components.schemas.Custom;

        expect(result.diagnostics).toEqual([]);
        for (const [keyword, payload] of Object.entries(opaquePayloads)) {
          expect(schema[keyword]).toEqual(payload);
        }

        const refSibling = parseOutput(result.output, format).components.schemas.RefSibling;
        const siblingKeywords = dereference ? refSibling.allOf[1] : refSibling;
        const literalRef = { $ref: "./shared.yaml#/$defs/Data" };
        expect(siblingKeywords.custom).toEqual({ properties: { arbitrary: literalRef } });
        expect(siblingKeywords.default).toEqual(literalRef);
        expect(refSibling["x-meta"]).toEqual(literalRef);
        expect(siblingKeywords.discriminator.mapping.data).toMatch(/^#\/components\/schemas\//);

        if (dereference) {
          expect(schema.properties.knownProperty).toEqual({ type: "integer" });
          expect(schema.allOf).toEqual([{ type: "string" }]);
          expect(schema.$defs.KnownDefinition).toEqual({ type: "integer" });
          expect(refSibling.allOf[0]).toEqual({ type: "boolean" });
          expect(siblingKeywords.properties.knownSibling).toEqual({ type: "integer" });
        } else {
          expect(schema.properties.knownProperty.$ref).toMatch(/^#\/components\/schemas\//);
          expect(schema.allOf[0].$ref).toMatch(/^#\/components\/schemas\//);
          expect(schema.$defs.KnownDefinition.$ref).toMatch(/^#\/components\/schemas\//);
          expect(refSibling.$ref).toMatch(/^#\/components\/schemas\//);
          expect(siblingKeywords.properties.knownSibling.$ref).toMatch(/^#\/components\/schemas\//);
        }
      });
    }
  }

  test("real OpenAPI containers continue to apply their reference semantics", async () => {
    const entry = "/virtual/openapi-containers.yaml";
    const fs = new InMemoryFileSystem({
      [entry]: [
        "openapi: 3.1.0",
        "info: { title: Real containers, version: '1' }",
        "paths:",
        "  /real: { $ref: './parts.yaml#/PathItem' }",
        "components:",
        "  responses:",
        "    Real: { $ref: './parts.yaml#/Response' }",
        "  parameters:",
        "    Real: { $ref: './parts.yaml#/Parameter' }",
        "  callbacks:",
        "    Real: { $ref: './parts.yaml#/Callback' }",
        "  examples:",
        "    Real: { $ref: './parts.yaml#/Example' }",
      ].join("\n"),
      "/virtual/parts.yaml": [
        "PathItem:",
        "  get: { operationId: realPath, responses: { '204': { description: No content } } }",
        "Response: { description: realResponse }",
        "Parameter: { name: realParameter, in: query, schema: { type: string } }",
        "Callback:",
        "  '{$request.body#/url}':",
        "    post: { responses: { '204': { description: No content } } }",
        "Example: { value: { marker: realExample } }",
      ].join("\n"),
    });

    const result = bundle(await loadWorkspaceGraph(fs, entry));
    const doc = parseYaml(result.output) as any;

    expect(result.diagnostics).toEqual([]);
    expect(doc.paths["/real"].get.operationId).toBe("realPath");
    expect(doc.components.responses.Real.$ref).toMatch(/^#\/components\/responses\//);
    expect(doc.components.parameters.Real.$ref).toMatch(/^#\/components\/parameters\//);
    expect(doc.components.callbacks.Real.$ref).toMatch(/^#\/components\/callbacks\//);
    expect(doc.components.examples.Real.$ref).toMatch(/^#\/components\/examples\//);
  });

  test("OpenAPI 3.0 known schema applicators and real containers retain existing behavior", async () => {
    const entry = "/virtual/entry-30.yaml";
    const fs = new InMemoryFileSystem({
      [entry]: [
        "openapi: 3.0.3",
        "info: { title: OpenAPI 3.0 control, version: '1' }",
        "paths:",
        "  /real: { $ref: './parts-30.yaml#/PathItem' }",
        "components:",
        "  schemas:",
        "    Control:",
        "      properties:",
        "        value: { $ref: './parts-30.yaml#/Schema' }",
        "      allOf:",
        "        - { $ref: './parts-30.yaml#/Schema' }",
      ].join("\n"),
      "/virtual/parts-30.yaml": [
        "PathItem:",
        "  get: { responses: { '204': { description: No content } } }",
        "Schema: { type: string, nullable: true }",
      ].join("\n"),
    });

    const result = bundle(await loadWorkspaceGraph(fs, entry));
    const doc = parseYaml(result.output) as any;

    expect(result.diagnostics).toEqual([]);
    expect(doc.paths["/real"].get.responses["204"].description).toBe("No content");
    expect(doc.components.schemas.Control.properties.value.$ref).toMatch(/^#\/components\/schemas\//);
    expect(doc.components.schemas.Control.allOf[0].$ref).toMatch(/^#\/components\/schemas\//);
  });
});
