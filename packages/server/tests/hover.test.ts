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
