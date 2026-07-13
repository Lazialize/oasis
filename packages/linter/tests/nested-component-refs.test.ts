import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

/**
 * Issue #36: a `$ref` whose target lies *below* a top-level component
 * (`#/components/schemas/Foo/properties/id`) must mark `Foo` itself as used, so
 * `components/no-unused` neither false-positives nor offers a remove-unused quick fix
 * that would delete a live component.
 */

async function lintFiles(files: Record<string, string>, entry = "/virtual/entry.yaml") {
  const fs = new InMemoryFileSystem(files);
  const graph = await loadWorkspaceGraph(fs, entry);
  return lint(graph, resolveConfig(undefined));
}

const header = `openapi: 3.1.0
info:
  title: Nested
  version: "1.0.0"
`;

describe("components/no-unused with nested component pointers (issue #36)", () => {
  test("a local $ref below a component's interior marks the component as used", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `${header}paths:
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
                $ref: "#/components/schemas/Foo/properties/id"
components:
  schemas:
    Foo:
      type: object
      properties:
        id:
          type: string
`,
    });
    expect(diagnostics.filter((d) => d.rule === "components/no-unused")).toEqual([]);
  });

  test("a cross-file $ref into a component's interior marks that component as used", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `${header}paths:
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
                $ref: "./shared.yaml#/components/schemas/Foo/properties/id"
`,
      "/virtual/shared.yaml": `${header}paths: {}
components:
  schemas:
    Foo:
      type: object
      properties:
        id:
          type: string
`,
    });
    expect(diagnostics.filter((d) => d.rule === "components/no-unused")).toEqual([]);
  });

  test("a genuinely unused component is still flagged (usable by the remove-unused quick fix)", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `${header}paths: {}
components:
  schemas:
    Orphan:
      type: object
`,
    });
    const unused = diagnostics.filter((d) => d.rule === "components/no-unused");
    expect(unused.length).toBe(1);
    expect(unused[0]?.message).toContain("Orphan");
  });

  test("a nested pointer to one component does not mark sibling components as used", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `${header}paths:
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
                $ref: "#/components/schemas/Foo/properties/id"
components:
  schemas:
    Foo:
      type: object
      properties:
        id:
          type: string
    Bar:
      type: object
`,
    });
    const unused = diagnostics.filter((d) => d.rule === "components/no-unused");
    expect(unused.length).toBe(1);
    expect(unused[0]?.message).toContain("Bar");
  });
});
