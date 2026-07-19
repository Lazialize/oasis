import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { createServerContext } from "../src/workspace.ts";
import { getHover } from "../src/handlers/hover.ts";
import { ENTRY_PATH, ENTRY_TEXT, fixtureFiles } from "./fixtures.ts";
import { positionOf } from "./helpers.ts";

describe("getHover", () => {
  test("summarizes the resolved schema: kind, description, properties", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(fixtureFiles()));
    const position = positionOf(ENTRY_TEXT, "#/components/schemas/Pet");

    const result = await getHover(ctx, { path: ENTRY_PATH, position });

    expect(result).toBeDefined();
    expect(result?.contents).toContain("Schema");
    expect(result?.contents).toContain("A pet");
    expect(result?.contents).toContain("`id`");
    expect(result?.contents).toContain("`name`");
  });

  test("returns undefined off a $ref", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(fixtureFiles()));
    const position = positionOf(ENTRY_TEXT, "operationId");

    const result = await getHover(ctx, { path: ENTRY_PATH, position });

    expect(result).toBeUndefined();
  });
});

describe("getHover ignores ref-like strings in literal data (#182)", () => {
  const PATH = "/lit/openapi.yaml";

  test("a `#/...` pointer-shaped string in an `example` value produces no hover", async () => {
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
    const ctx = createServerContext(new InMemoryFileSystem({ [PATH]: text }));
    const result = await getHover(ctx, { path: PATH, position: positionOf(text, "#/components/schemas/Foo") });
    expect(result).toBeUndefined();
  });

  test("a Link Object `operationRef` still produces hover for the target operation", async () => {
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
    const ctx = createServerContext(new InMemoryFileSystem({ [PATH]: text }));
    const result = await getHover(ctx, { path: PATH, position: positionOf(text, "#/paths/~1pets/get") });
    expect(result).toBeDefined();
  });
});
