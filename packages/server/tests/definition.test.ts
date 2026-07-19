import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { createServerContext } from "../src/workspace.ts";
import { getDefinition } from "../src/handlers/definition.ts";
import { ENTRY_PATH, ENTRY_TEXT, SHARED_PATH, fixtureFiles } from "./fixtures.ts";
import { positionOf } from "./helpers.ts";

describe("getDefinition", () => {
  test("resolves an internal $ref to its range in the same file", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(fixtureFiles()));
    const position = positionOf(ENTRY_TEXT, "#/components/schemas/Pet");

    const result = await getDefinition(ctx, { path: ENTRY_PATH, position });

    expect(result).toBeDefined();
    expect(result?.targetPath).toBe(ENTRY_PATH);
    // Should land on the Pet schema definition, not the $ref site.
    expect(result?.range.start.line).toBeGreaterThan(position.line);
  });

  test("resolves a cross-file $ref to the target file and range", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(fixtureFiles()));
    const position = positionOf(ENTRY_TEXT, "./shared.yaml#/components/schemas/Owner");

    const result = await getDefinition(ctx, { path: ENTRY_PATH, position });

    expect(result).toBeDefined();
    expect(result?.targetPath).toBe(SHARED_PATH);
    expect(result?.range.filePath).toBe(SHARED_PATH);
  });

  test("returns undefined when the cursor is not on a ref-like string", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(fixtureFiles()));
    const position = positionOf(ENTRY_TEXT, "listPets");

    const result = await getDefinition(ctx, { path: ENTRY_PATH, position });

    expect(result).toBeUndefined();
  });
});

describe("getDefinition ignores ref-like strings in literal data (#182)", () => {
  const PATH = "/lit/openapi.yaml";

  function ctxFor(text: string) {
    return createServerContext(new InMemoryFileSystem({ [PATH]: text }));
  }

  test("a `#/...` pointer-shaped string in an `example` value is not a ref", async () => {
    const text = `openapi: 3.1.0
info: { title: Repro, version: "1.0.0" }
paths: {}
components:
  schemas:
    Foo: { type: string }
    Holder:
      type: string
      example: '#/components/schemas/Foo'
`;
    const result = await getDefinition(ctxFor(text), { path: PATH, position: positionOf(text, "#/components/schemas/Foo") });
    expect(result).toBeUndefined();
  });

  test("a relative-file-shaped string in a `default` value is not a ref", async () => {
    const text = `openapi: 3.1.0
info: { title: Repro, version: "1.0.0" }
paths: {}
components:
  schemas:
    Holder:
      type: string
      default: '../other.yaml'
`;
    const result = await getDefinition(ctxFor(text), { path: PATH, position: positionOf(text, "../other.yaml") });
    expect(result).toBeUndefined();
  });

  test("a `#/...` pointer-shaped string inside an `enum` value is not a ref", async () => {
    const text = `openapi: 3.1.0
info: { title: Repro, version: "1.0.0" }
paths: {}
components:
  schemas:
    Foo: { type: string }
    Holder:
      type: string
      enum:
        - '#/components/schemas/Foo'
`;
    const result = await getDefinition(ctxFor(text), { path: PATH, position: positionOf(text, "#/components/schemas/Foo") });
    expect(result).toBeUndefined();
  });

  test("a `#/...` pointer-shaped string inside a `const` value is not a ref", async () => {
    const text = `openapi: 3.1.0
info: { title: Repro, version: "1.0.0" }
paths: {}
components:
  schemas:
    Foo: { type: string }
    Holder:
      const: '#/components/schemas/Foo'
`;
    const result = await getDefinition(ctxFor(text), { path: PATH, position: positionOf(text, "#/components/schemas/Foo") });
    expect(result).toBeUndefined();
  });

  test("a `#/...` pointer-shaped string inside an `x-*` extension payload is not a ref", async () => {
    const text = `openapi: 3.1.0
info: { title: Repro, version: "1.0.0" }
paths: {}
components:
  schemas:
    Foo: { type: string }
    Holder:
      type: string
      x-vendor: '#/components/schemas/Foo'
`;
    const result = await getDefinition(ctxFor(text), { path: PATH, position: positionOf(text, "#/components/schemas/Foo") });
    expect(result).toBeUndefined();
  });

  test("a Link Object `operationRef` still resolves to the target operation", async () => {
    const text = `openapi: 3.1.0
info: { title: Repro, version: "1.0.0" }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
components:
  responses:
    Ok:
      description: OK
      links:
        Self:
          operationRef: '#/paths/~1pets/get'
`;
    const result = await getDefinition(ctxFor(text), { path: PATH, position: positionOf(text, "#/paths/~1pets/get") });
    expect(result).toBeDefined();
    expect(result?.targetPath).toBe(PATH);
    // Should land on the `get` operation, before the Link Object referring to it.
    expect(result?.range.start.line).toBeLessThan(positionOf(text, "operationRef").line);
  });
});
