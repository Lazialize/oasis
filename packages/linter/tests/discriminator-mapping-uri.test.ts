import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";
import { classifyMappingValue } from "../src/util.ts";

/**
 * Issue #39: discriminator mapping values must be classified per RFC 3986. Only a bare component
 * name (`^[a-zA-Z0-9._-]+$`, no `/` or `:`) is shorthand for `#/components/schemas/<name>`; a
 * relative path (`./dog.yaml`), an absolute scheme without `//` (`urn:`), a fragment, or a
 * percent-encoded reference is a URI reference with normal $ref semantics.
 */

async function lintFiles(files: Record<string, string>, entry = "/virtual/entry.yaml") {
  const fs = new InMemoryFileSystem(files);
  const graph = await loadWorkspaceGraph(fs, entry);
  return lint(graph, resolveConfig(undefined));
}

const petsDoc = (mapping: string) => `openapi: 3.1.0
info:
  title: Disc
  version: "1.0.0"
paths: {}
components:
  schemas:
    Pet:
      oneOf:
        - $ref: "#/components/schemas/Dog"
      discriminator:
        propertyName: petType
        mapping:
${mapping}
    Dog:
      type: object
      properties:
        petType:
          type: string
`;

const dogFile = `openapi: 3.1.0
info:
  title: Dog
  version: "1.0.0"
paths: {}
components:
  schemas:
    Dog:
      type: object
      properties:
        petType:
          type: string
`;

function discriminatorDiags(diags: { rule: string; message: string }[]) {
  return diags.filter((d) => d.rule === "structure/discriminator" && d.message.includes("mapping"));
}

describe("classifyMappingValue (issue #39)", () => {
  test("bare component names map to the schemas shorthand", () => {
    expect(classifyMappingValue("Dog")).toEqual({ kind: "component", ref: "#/components/schemas/Dog" });
    expect(classifyMappingValue("dog.v2")).toEqual({ kind: "component", ref: "#/components/schemas/dog.v2" });
    expect(classifyMappingValue("dog_kind-1")).toEqual({ kind: "component", ref: "#/components/schemas/dog_kind-1" });
  });

  test("relative paths, fragments, and percent-encoded values are URI references", () => {
    expect(classifyMappingValue("./dog.yaml")).toEqual({ kind: "reference", ref: "./dog.yaml" });
    expect(classifyMappingValue("../schemas/dog.yaml")).toEqual({ kind: "reference", ref: "../schemas/dog.yaml" });
    expect(classifyMappingValue("#/components/schemas/Dog")).toEqual({ kind: "reference", ref: "#/components/schemas/Dog" });
    expect(classifyMappingValue("dog%20v2.yaml#/components/schemas/Dog")).toEqual({
      kind: "reference",
      ref: "dog%20v2.yaml#/components/schemas/Dog",
    });
  });

  test("absolute non-filesystem URIs (with or without //) are external", () => {
    expect(classifyMappingValue("https://example.com/dog.yaml#/Dog")).toEqual({ kind: "external" });
    expect(classifyMappingValue("urn:example:dog")).toEqual({ kind: "external" });
    expect(classifyMappingValue("//example.com/dog.yaml")).toEqual({ kind: "external" });
  });
});

describe("structure/discriminator mapping URI classification (issue #39)", () => {
  test("a relative-path mapping value resolving to a real file is not reported", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": petsDoc(`          dog: "./dog.yaml#/components/schemas/Dog"\n          pup: "./dog.yaml"`),
      "/virtual/dog.yaml": dogFile,
    });
    expect(discriminatorDiags(diagnostics)).toEqual([]);
  });

  test("a urn: mapping value is treated as external and skipped", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": petsDoc(`          dog: "urn:example:dog"`),
    });
    expect(discriminatorDiags(diagnostics)).toEqual([]);
  });

  test("a bare component name that doesn't exist is still reported", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": petsDoc(`          cat: "Cat"`),
    });
    const diags = discriminatorDiags(diagnostics);
    expect(diags.length).toBe(1);
    expect(diags[0]?.message).toContain('"Cat"');
  });

  test("a relative path that doesn't resolve is reported", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": petsDoc(`          dog: "./missing.yaml#/components/schemas/Dog"`),
    });
    expect(discriminatorDiags(diagnostics).length).toBe(1);
  });
});

describe("components/no-unused with URI mapping values (issue #39)", () => {
  test("a schema referenced only via a relative-path mapping value counts as used", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.1.0
info:
  title: Disc
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      tags: [a]
      description: x
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Pet"
components:
  schemas:
    Pet:
      oneOf:
        - $ref: "./dog.yaml#/components/schemas/Dog"
      discriminator:
        propertyName: petType
        mapping:
          dog: "./dog.yaml#/components/schemas/Dog"
`,
      "/virtual/dog.yaml": dogFile,
    });
    expect(diagnostics.filter((d) => d.rule === "components/no-unused")).toEqual([]);
  });
});
