import { describe, expect, test } from "bun:test";
import { buildAnchorIndex } from "../src/anchor.ts";
import { InMemoryFileSystem } from "../src/filesystem.ts";
import { allDiagnostics, loadWorkspaceGraph } from "../src/graph.ts";
import { findRefs } from "../src/ref.ts";

describe("Specification Extension payloads are opaque (#91)", () => {
  test("extension refs load no files and extension anchors are not indexed", async () => {
    const fs = new InMemoryFileSystem({
      "/v/entry.yaml": [
        "openapi: 3.1.0",
        "info:",
        "  title: Extensions",
        "  version: '1'",
        "  x-meta:",
        "    $ref: './missing-info.yaml'",
        "    $anchor: HiddenInfo",
        "paths:",
        "  x-routing:",
        "    $ref: './missing-path.yaml'",
        "    $anchor: HiddenPath",
        "  /events:",
        "    post:",
        "      callbacks:",
        "        onEvent:",
        "          x-routing:",
        "            $ref: './missing-callback.yaml'",
        "            $anchor: HiddenCallback",
        "      responses:",
        "        x-meta:",
        "          $ref: './missing-response.yaml'",
        "          $anchor: HiddenResponse",
        "webhooks:",
        "  x-hook:",
        "    $ref: './webhook.yaml'",
        "components:",
        "  pathItems:",
        "    x-path-item:",
        "      $ref: './path-item.yaml'",
        "  schemas:",
        "    Real:",
        "      type: string",
        "      $anchor: RealAnchor",
        "      x-meta:",
        "        $ref: './missing-schema-meta.yaml'",
        "        $anchor: HiddenSchema",
        "      dependentSchemas:",
        "        x-dependent:",
        "          $ref: './dependent.yaml#/Dep'",
        "          $anchor: DependentAnchor",
        // An x-* name inside a user-named container is a real Schema Object, not an extension.
        "    x-named-schema:",
        "      $ref: './real.yaml#/External'",
        "      $anchor: NamedSchemaAnchor",
      ].join("\n"),
      "/v/real.yaml": "External: { type: integer }\n",
      "/v/webhook.yaml": "post: { operationId: xHook }\n",
      "/v/path-item.yaml": "get: { operationId: xPathItem }\n",
      "/v/dependent.yaml": "Dep: { type: boolean }\n",
    });

    const graph = await loadWorkspaceGraph(fs, "/v/entry.yaml");
    const doc = graph.documents.get("/v/entry.yaml")!;

    expect([...graph.documents.keys()].sort()).toEqual([
      "/v/dependent.yaml",
      "/v/entry.yaml",
      "/v/path-item.yaml",
      "/v/real.yaml",
      "/v/webhook.yaml",
    ]);
    expect(allDiagnostics(graph)).toEqual([]);
    expect(findRefs(doc).map((ref) => ref.value).sort()).toEqual([
      "./dependent.yaml#/Dep",
      "./path-item.yaml",
      "./real.yaml#/External",
      "./webhook.yaml",
    ]);
    expect([...buildAnchorIndex(doc).byName.keys()].sort()).toEqual([
      "DependentAnchor",
      "NamedSchemaAnchor",
      "RealAnchor",
    ]);
  });

  test("aliased components and response maps keep genuine refs independent of source order", async () => {
    const pathsBlock = [
      "paths:",
      "  /test:",
      "    get:",
      "      responses: *responses",
    ];
    const componentsBlock = ["components: *components"];

    for (const blocks of [
      [...pathsBlock, ...componentsBlock],
      [...componentsBlock, ...pathsBlock],
    ]) {
      const fs = new InMemoryFileSystem({
        "/v/entry.yaml": [
          "openapi: 3.1.0",
          "info: { title: Alias contexts, version: '1' }",
          "x-seed:",
          "  responseMap: &responses",
          "    x-shared:",
          "      $ref: './real.yaml#/R'",
          "  componentsMap: &components",
          "    responses: *responses",
          ...blocks,
        ].join("\n"),
        "/v/real.yaml": "R: { description: real }\n",
      });

      const graph = await loadWorkspaceGraph(fs, "/v/entry.yaml");
      const doc = graph.documents.get("/v/entry.yaml")!;

      expect([...graph.documents.keys()].sort()).toEqual(["/v/entry.yaml", "/v/real.yaml"]);
      expect(findRefs(doc).map((ref) => ref.value)).toEqual(["./real.yaml#/R"]);
      expect(allDiagnostics(graph)).toEqual([]);
    }
  });
});
