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
});
