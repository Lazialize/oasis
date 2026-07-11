import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { keyCompletionsForPointer, refCompletionsForPointer } from "../src/handlers/completion.ts";
import { ENTRY_PATH, fixtureFiles } from "./fixtures.ts";

describe("keyCompletionsForPointer", () => {
  test("root position suggests top-level OpenAPI keys", () => {
    const labels = keyCompletionsForPointer("", "3.1").map((i) => i.label);
    expect(labels).toContain("openapi");
    expect(labels).toContain("paths");
    expect(labels).toContain("components");
  });

  test("operation position suggests operation keys", () => {
    const labels = keyCompletionsForPointer("/paths/~1pets/get", "3.1").map((i) => i.label);
    expect(labels).toContain("operationId");
    expect(labels).toContain("responses");
    expect(labels).toContain("requestBody");
  });

  test("excludes keys already present on the object", () => {
    const labels = keyCompletionsForPointer("/paths/~1pets/get", "3.1", ["operationId", "responses"]).map((i) => i.label);
    expect(labels).not.toContain("operationId");
    expect(labels).not.toContain("responses");
    expect(labels).toContain("summary");
  });

  test("schema position: 3.0 offers `nullable`, not `const`/`examples`", () => {
    const labels = keyCompletionsForPointer("/components/schemas/Pet", "3.0").map((i) => i.label);
    expect(labels).toContain("nullable");
    expect(labels).not.toContain("const");
    expect(labels).not.toContain("examples");
  });

  test("schema position: 3.1 offers `const`/`examples`, not `nullable`", () => {
    const labels = keyCompletionsForPointer("/components/schemas/Pet", "3.1").map((i) => i.label);
    expect(labels).not.toContain("nullable");
    expect(labels).toContain("const");
    expect(labels).toContain("examples");
  });

  test("unclassifiable pointer yields no suggestions", () => {
    expect(keyCompletionsForPointer("/servers/0", "3.1")).toEqual([]);
  });
});

describe("refCompletionsForPointer", () => {
  test("lists internal and cross-file schema targets", async () => {
    const fs = new InMemoryFileSystem(fixtureFiles());
    const graph = await loadWorkspaceGraph(fs, ENTRY_PATH);
    const entryDoc = graph.documents.get(ENTRY_PATH)!;

    const items = refCompletionsForPointer(entryDoc, graph, "/paths/~1pets/get/responses/200/content/application~1json/schema/$ref").map(
      (i) => i.label,
    );

    expect(items).toContain("#/components/schemas/Pet");
    expect(items).toContain("#/components/schemas/Owner");
    expect(items).toContain("./shared.yaml#/components/schemas/Owner");
  });

  test("no suggestions when the containing object isn't a known component-backed kind", async () => {
    const fs = new InMemoryFileSystem(fixtureFiles());
    const graph = await loadWorkspaceGraph(fs, ENTRY_PATH);
    const entryDoc = graph.documents.get(ENTRY_PATH)!;

    expect(refCompletionsForPointer(entryDoc, graph, "/info/$ref")).toEqual([]);
  });
});
