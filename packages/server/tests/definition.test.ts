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
