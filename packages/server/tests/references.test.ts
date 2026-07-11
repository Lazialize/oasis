import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { getReferences } from "../src/handlers/references.ts";
import { scanWorkspaceRootsForProjects } from "../src/project.ts";
import { createServerContext } from "../src/workspace.ts";
import { positionOf } from "./helpers.ts";
import { ENTRY_PATH, ENTRY_TEXT, FRAGMENT_PATH, FRAGMENT_TEXT, ROOT, refsFixtureFiles } from "./refs-fixtures.ts";

async function contextWithProject() {
  const ctx = createServerContext(new InMemoryFileSystem(refsFixtureFiles()));
  await scanWorkspaceRootsForProjects(ctx, [ROOT]);
  return ctx;
}

/** The three `$ref`s that resolve to `Pet`: two in the fragment file, one within the entry. */
function expectAllPetRefs(results: { filePath: string }[]) {
  const byFile = results.map((r) => r.filePath).sort();
  expect(byFile).toEqual([ENTRY_PATH, FRAGMENT_PATH, FRAGMENT_PATH].sort());
}

describe("getReferences", () => {
  test("from the definition key finds every $ref across the graph", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const results = await getReferences(ctx, { path: ENTRY_PATH, position, includeDeclaration: false });

    expect(results).toHaveLength(3);
    expectAllPetRefs(results);
  });

  test("from inside the component's subtree finds the same references", async () => {
    const ctx = await contextWithProject();
    // Cursor on "type: object" inside the Pet schema body, not on the key itself.
    const position = positionOf(ENTRY_TEXT, "type: object");

    const results = await getReferences(ctx, { path: ENTRY_PATH, position, includeDeclaration: false });

    expect(results).toHaveLength(3);
    expectAllPetRefs(results);
  });

  test("from a $ref value resolves to the target first, then finds all references to it", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(FRAGMENT_TEXT, "../openapi.yaml#/components/schemas/Pet");

    const results = await getReferences(ctx, { path: FRAGMENT_PATH, position, includeDeclaration: false });

    expect(results).toHaveLength(3);
    expectAllPetRefs(results);
  });

  test("includeDeclaration: false omits the definition site", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");
    const declLine = ENTRY_TEXT.split("\n").findIndex((l) => l.trim() === "Pet:");

    const results = await getReferences(ctx, { path: ENTRY_PATH, position, includeDeclaration: false });

    expect(results).toHaveLength(3);
    expect(results.some((r) => r.filePath === ENTRY_PATH && r.range.start.line === declLine)).toBe(false);
  });

  test("includeDeclaration: true includes the component key range", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const results = await getReferences(ctx, { path: ENTRY_PATH, position, includeDeclaration: true });

    expect(results).toHaveLength(4);
    const declLine = ENTRY_TEXT.split("\n").findIndex((l) => l.trim() === "Pet:");
    const decl = results.find((r) => r.filePath === ENTRY_PATH && r.range.start.line === declLine);
    expect(decl).toBeDefined();
    const declLineText = ENTRY_TEXT.split("\n")[declLine]!;
    expect(declLineText.slice(decl!.range.start.character, decl!.range.end.character)).toBe("Pet");
  });

  test("cross-file references include the fragment file in project mode", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const results = await getReferences(ctx, { path: ENTRY_PATH, position, includeDeclaration: false });

    const fragmentRefs = results.filter((r) => r.filePath === FRAGMENT_PATH);
    expect(fragmentRefs).toHaveLength(2);
  });

  test("cursor not on a component returns an empty list", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(FRAGMENT_TEXT, "listPets");

    const results = await getReferences(ctx, { path: FRAGMENT_PATH, position, includeDeclaration: false });

    expect(results).toEqual([]);
  });
});
