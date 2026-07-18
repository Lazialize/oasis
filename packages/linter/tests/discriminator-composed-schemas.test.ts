import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

/**
 * Issue #106: `structure/discriminator` must derive a branch's effective `properties`/`required`
 * through `allOf` composition and `$ref` resolution, and must accept the official
 * parent-discriminator pattern (children reference the parent via `allOf`) without requiring a
 * composition keyword on the parent Schema itself.
 */

async function lintFiles(files: Record<string, string>, entry = "/virtual/entry.yaml") {
  const fs = new InMemoryFileSystem(files);
  const graph = await loadWorkspaceGraph(fs, entry);
  return lint(graph, resolveConfig(undefined));
}

function discriminatorDiags(diags: { rule: string; message: string }[]) {
  return diags.filter((d) => d.rule === "structure/discriminator");
}

describe("structure/discriminator effective composed schemas (issue #106)", () => {
  test("3.0: oneOf branch inheriting propertyName + required through allOf is accepted", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.0.3
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    Base:
      type: object
      properties:
        kind: { type: string }
      required: [kind]
    Cat:
      allOf:
        - $ref: '#/components/schemas/Base'
        - type: object
          properties:
            meow: { type: boolean }
    Animal:
      oneOf:
        - $ref: '#/components/schemas/Cat'
      discriminator:
        propertyName: kind
`,
    });
    expect(discriminatorDiags(diagnostics)).toEqual([]);
  });

  test("3.1: oneOf branch inheriting propertyName through allOf is accepted", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.1.0
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    Base:
      type: object
      properties:
        kind: { type: string }
      required: [kind]
    Cat:
      allOf:
        - $ref: '#/components/schemas/Base'
        - type: object
          properties:
            meow: { type: boolean }
    Animal:
      oneOf:
        - $ref: '#/components/schemas/Cat'
      discriminator:
        propertyName: kind
`,
    });
    expect(discriminatorDiags(diagnostics)).toEqual([]);
  });

  test("3.0: parent-discriminator pattern (children allOf the parent) is accepted", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.0.3
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    Pet:
      type: object
      properties:
        petType: { type: string }
      required: [petType]
      discriminator:
        propertyName: petType
        mapping:
          cat: '#/components/schemas/Cat'
          dog: '#/components/schemas/Dog'
    Cat:
      allOf:
        - $ref: '#/components/schemas/Pet'
        - type: object
          properties:
            meow: { type: boolean }
    Dog:
      allOf:
        - $ref: '#/components/schemas/Pet'
        - type: object
          properties:
            bark: { type: boolean }
`,
    });
    expect(discriminatorDiags(diagnostics)).toEqual([]);
  });

  test("3.1: parent-discriminator pattern is accepted (no required needed in 3.1)", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.1.0
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    Pet:
      type: object
      properties:
        petType: { type: string }
      discriminator:
        propertyName: petType
    Cat:
      allOf:
        - $ref: '#/components/schemas/Pet'
`,
    });
    expect(discriminatorDiags(diagnostics)).toEqual([]);
  });

  test("nested allOf: propertyName defined two allOf levels deep is accepted", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.1.0
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    Root:
      type: object
      properties:
        kind: { type: string }
    Middle:
      allOf:
        - $ref: '#/components/schemas/Root'
    Leaf:
      allOf:
        - $ref: '#/components/schemas/Middle'
        - type: object
          properties:
            extra: { type: string }
    Animal:
      oneOf:
        - $ref: '#/components/schemas/Leaf'
      discriminator:
        propertyName: kind
`,
    });
    expect(discriminatorDiags(diagnostics)).toEqual([]);
  });

  test("external ref: branch resolving through allOf across files is accepted", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.0.3
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    Animal:
      oneOf:
        - $ref: './cat.yaml#/components/schemas/Cat'
      discriminator:
        propertyName: kind
`,
      "/virtual/cat.yaml": `openapi: 3.0.3
info: { title: Cat, version: "1" }
paths: {}
components:
  schemas:
    Base:
      type: object
      properties:
        kind: { type: string }
      required: [kind]
    Cat:
      allOf:
        - $ref: '#/components/schemas/Base'
        - type: object
          properties:
            meow: { type: boolean }
`,
    });
    expect(discriminatorDiags(diagnostics)).toEqual([]);
  });

  test("cyclic allOf refs do not hang and do not crash", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.1.0
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    A:
      allOf:
        - $ref: '#/components/schemas/B'
    B:
      allOf:
        - $ref: '#/components/schemas/A'
      properties:
        kind: { type: string }
    Animal:
      oneOf:
        - $ref: '#/components/schemas/A'
      discriminator:
        propertyName: kind
`,
    });
    // `kind` is reachable through A -> B, so no property diagnostic despite the cycle.
    expect(discriminatorDiags(diagnostics)).toEqual([]);
  });

  test("unresolvable ref in a branch's allOf suppresses discriminator diagnostics", async () => {
    // The branch composes a $ref to a file outside the workspace: its effective property set is
    // incomplete-but-unknowable, so neither the missing-property nor the 3.0 missing-required
    // diagnostic may fire (unknown is not missing).
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.0.3
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    Cat:
      allOf:
        - $ref: './missing-base.yaml#/components/schemas/Base'
        - type: object
          properties:
            meow: { type: boolean }
    Animal:
      oneOf:
        - $ref: '#/components/schemas/Cat'
      discriminator:
        propertyName: kind
`,
    });
    expect(discriminatorDiags(diagnostics)).toEqual([]);
  });

  describe("negative controls", () => {
    test("3.1: effective schema truly lacks the discriminator property is reported", async () => {
      const diagnostics = await lintFiles({
        "/virtual/entry.yaml": `openapi: 3.1.0
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    Base:
      type: object
      properties:
        other: { type: string }
    Cat:
      allOf:
        - $ref: '#/components/schemas/Base'
        - type: object
          properties:
            meow: { type: boolean }
    Animal:
      oneOf:
        - $ref: '#/components/schemas/Cat'
      discriminator:
        propertyName: kind
`,
      });
      const diags = discriminatorDiags(diagnostics);
      expect(diags.length).toBe(1);
      expect(diags[0]?.message).toContain('"kind"');
    });

    test("3.0: property defined but missing from effective required is reported", async () => {
      const diagnostics = await lintFiles({
        "/virtual/entry.yaml": `openapi: 3.0.3
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    Base:
      type: object
      properties:
        kind: { type: string }
    Cat:
      allOf:
        - $ref: '#/components/schemas/Base'
    Animal:
      oneOf:
        - $ref: '#/components/schemas/Cat'
      discriminator:
        propertyName: kind
`,
      });
      const diags = discriminatorDiags(diagnostics);
      expect(diags.length).toBe(1);
      expect(diags[0]?.message).toContain("required");
    });

    test("parent-discriminator pattern whose parent lacks the property is reported", async () => {
      const diagnostics = await lintFiles({
        "/virtual/entry.yaml": `openapi: 3.1.0
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    Pet:
      type: object
      properties:
        other: { type: string }
      discriminator:
        propertyName: petType
`,
      });
      const diags = discriminatorDiags(diagnostics);
      expect(diags.length).toBeGreaterThanOrEqual(1);
      expect(diags[0]?.message).toContain('"petType"');
    });
  });
});
