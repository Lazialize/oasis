import { describe, expect, test } from "bun:test";
import { indentationFallback } from "../src/indentation-fallback.ts";
import { positionOf } from "./helpers.ts";

describe("indentationFallback", () => {
  test("partially typed key on a new line resolves the enclosing operation", () => {
    const text = `openapi: 3.1.0
info:
  title: T
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      desc
`;
    const start = positionOf(text, "desc");
    const position = { line: start.line, character: start.character + "desc".length };
    const result = indentationFallback(text, position);
    expect(result).toBeDefined();
    expect(result?.containerPointer).toBe("/paths/~1pets/get");
    expect(result?.prefix).toBe("desc");
    expect(result?.replaceRange).toEqual({ start: { line: position.line, character: 6 }, end: position });
  });

  test("empty (correctly indented) line inside a block resolves the enclosing mapping", () => {
    const text = `openapi: 3.1.0
info:
  title: T
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      \x20
`;
    const position = { line: 8, character: 6 };
    const result = indentationFallback(text, position);
    expect(result).toBeDefined();
    expect(result?.containerPointer).toBe("/paths/~1pets/get");
    expect(result?.prefix).toBe("");
  });

  test("resolves inside a schema block", () => {
    const text = `openapi: 3.1.0
components:
  schemas:
    Pet:
      type: object
      titl
`;
    const position = positionOf(text, "titl");
    const result = indentationFallback(text, position);
    expect(result?.containerPointer).toBe("/components/schemas/Pet");
  });

  test("resolves at document root", () => {
    const text = `openapi: 3.1.0
inf
`;
    const position = positionOf(text, "inf");
    const result = indentationFallback(text, position);
    expect(result?.containerPointer).toBe("");
  });

  test("bails out when the current line already has a colon (not a bare key)", () => {
    const text = `openapi: 3.1.0
info:
  title: hello
`;
    const pos = { line: 2, character: "  title: hello".length };
    expect(indentationFallback(text, pos)).toBeUndefined();
  });

  test("bails out when an ancestor line is a sequence item", () => {
    const text = `openapi: 3.1.0
paths:
  /pets:
    get:
      parameters:
        - name: limit
          desc
`;
    const position = positionOf(text, "desc");
    expect(indentationFallback(text, position)).toBeUndefined();
  });
});
