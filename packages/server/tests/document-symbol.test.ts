import { describe, expect, test } from "bun:test";
import { parseDocument } from "@oasis/core";
import { getDocumentSymbols } from "../src/handlers/document-symbol.ts";
import { ENTRY_PATH, ENTRY_TEXT } from "./fixtures.ts";

describe("getDocumentSymbols", () => {
  test("builds an outline with info, paths (per operation), and components (per name)", () => {
    const doc = parseDocument(ENTRY_TEXT, ENTRY_PATH);
    const symbols = getDocumentSymbols(doc);

    const names = symbols.map((s) => s.name);
    expect(names).toEqual(["info", "paths", "components"]);

    const paths = symbols.find((s) => s.name === "paths")!;
    expect(paths.children.map((c) => c.name)).toEqual(["/pets"]);
    expect(paths.children[0]!.children.map((c) => c.name)).toEqual(["GET", "POST"]);
    expect(paths.children[0]!.children[0]!.kind).toBe("operation");

    const components = symbols.find((s) => s.name === "components")!;
    const schemas = components.children.find((c) => c.name === "schemas")!;
    expect(schemas.children.map((c) => c.name)).toEqual(["Pet", "Owner"]);
    expect(schemas.children[0]!.kind).toBe("object");
  });

  test("3.1 webhooks: inline webhook with operation children appears after paths", () => {
    const text = [
      "openapi: 3.1.0",
      "info:",
      "  title: Test API",
      '  version: "1.0.0"',
      "paths:",
      "  /pets:",
      "    get:",
      "      operationId: listPets",
      "      responses:",
      "        '200':",
      "          description: OK",
      "webhooks:",
      "  newPet:",
      "    post:",
      "      operationId: onNewPet",
      "      responses:",
      "        '200':",
      "          description: OK",
      "",
    ].join("\n");
    const doc = parseDocument(text, "/repo/openapi.yaml");
    const symbols = getDocumentSymbols(doc);

    expect(symbols.map((s) => s.name)).toEqual(["info", "paths", "webhooks"]);
    const webhooks = symbols.find((s) => s.name === "webhooks")!;
    expect(webhooks.kind).toBe("namespace");
    expect(webhooks.children.map((c) => c.name)).toEqual(["newPet"]);
    expect(webhooks.children[0]!.children.map((c) => c.name)).toEqual(["POST"]);
    expect(webhooks.children[0]!.children[0]!.kind).toBe("operation");
  });

  test("3.1 webhooks: a referenced Path Item ($ref) appears as a childless webhook entry", () => {
    const text = [
      "openapi: 3.1.0",
      "info:",
      "  title: Test API",
      '  version: "1.0.0"',
      "webhooks:",
      "  newPet:",
      "    $ref: './paths/newPet.yaml'",
      "",
    ].join("\n");
    const doc = parseDocument(text, "/repo/openapi.yaml");
    const symbols = getDocumentSymbols(doc);

    const webhooks = symbols.find((s) => s.name === "webhooks")!;
    expect(webhooks.children.map((c) => c.name)).toEqual(["newPet"]);
    expect(webhooks.children[0]!.children).toEqual([]);
  });

  test("3.0 document: a stray webhooks key is not part of the outline", () => {
    const text = [
      "openapi: 3.0.3",
      "info:",
      "  title: Test API",
      '  version: "1.0.0"',
      "paths: {}",
      "webhooks:",
      "  newPet:",
      "    post:",
      "      operationId: onNewPet",
      "",
    ].join("\n");
    const doc = parseDocument(text, "/repo/openapi.yaml");
    const symbols = getDocumentSymbols(doc);

    expect(symbols.some((s) => s.name === "webhooks")).toBe(false);
  });
});
