import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import type { Range } from "@oasis/core";
import { prepareRename, renameComponent } from "../src/handlers/rename.ts";
import { OverlayFileSystem } from "../src/overlay-fs.ts";
import { scanWorkspaceRootsForProjects } from "../src/project.ts";
import { createServerContext } from "../src/workspace.ts";
import { positionOf } from "./helpers.ts";
import { ENTRY_PATH, ENTRY_TEXT, FRAGMENT_PATH, FRAGMENT_TEXT, ROOT, refsFixtureFiles } from "./refs-fixtures.ts";
import {
  ENTRY_A_PATH,
  ENTRY_A_TEXT,
  ENTRY_B_PATH,
  ENTRY_B_TEXT,
  ROOT as MULTI_ROOT,
  SHARED_PATH,
  SHARED_TEXT,
  multiEntryFiles,
} from "./multi-entry-fixtures.ts";

async function contextWithProject() {
  const ctx = createServerContext(new InMemoryFileSystem(refsFixtureFiles()));
  await scanWorkspaceRootsForProjects(ctx, [ROOT]);
  return ctx;
}

/** The exact substring a Range covers within `text` (single-line ranges only, which is all this
 * feature ever produces). */
function textAt(text: string, range: Range): string {
  const line = text.split("\n")[range.start.line];
  if (line === undefined || range.start.line !== range.end.line) {
    throw new Error(`unexpected multi-line or out-of-range: ${JSON.stringify(range)}`);
  }
  return line.slice(range.start.character, range.end.character);
}

describe("prepareRename", () => {
  test("valid on the definition key: range covers just the name, placeholder is the current name", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const result = await prepareRename(ctx, { path: ENTRY_PATH, position });

    expect(result).toBeDefined();
    expect(result?.placeholder).toBe("Pet");
    expect(textAt(ENTRY_TEXT, result!.range)).toBe("Pet");
  });

  test("valid on a $ref value: range covers just the final pointer segment, not the whole ref string", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(FRAGMENT_TEXT, "../openapi.yaml#/components/schemas/Pet");

    const result = await prepareRename(ctx, { path: FRAGMENT_PATH, position });

    expect(result).toBeDefined();
    expect(result?.placeholder).toBe("Pet");
    expect(textAt(FRAGMENT_TEXT, result!.range)).toBe("Pet");
  });

  test("invalid position returns undefined", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(FRAGMENT_TEXT, "listPets");

    const result = await prepareRename(ctx, { path: FRAGMENT_PATH, position });

    expect(result).toBeUndefined();
  });
});

describe("renameComponent", () => {
  test("from the definition key: edits the key plus every referencing $ref across files", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: ENTRY_PATH, position, newName: "PetV2" });

    expect(edits).toBeDefined();
    expect(edits).toHaveLength(4);
    for (const edit of edits!) {
      expect(edit.newText).toBe("PetV2");
    }

    const byFile = new Map<string, typeof edits>();
    for (const edit of edits!) {
      byFile.set(edit.filePath, [...(byFile.get(edit.filePath) ?? []), edit]);
    }
    expect(byFile.get(ENTRY_PATH)).toHaveLength(2);
    expect(byFile.get(FRAGMENT_PATH)).toHaveLength(2);

    for (const edit of byFile.get(ENTRY_PATH)!) {
      expect(textAt(ENTRY_TEXT, edit.range)).toBe("Pet");
    }
    for (const edit of byFile.get(FRAGMENT_PATH)!) {
      expect(textAt(FRAGMENT_TEXT, edit.range)).toBe("Pet");
    }
  });

  test("from a $ref: produces the same edit set as renaming from the definition", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(FRAGMENT_TEXT, "../openapi.yaml#/components/schemas/Pet");

    const edits = await renameComponent(ctx, { path: FRAGMENT_PATH, position, newName: "PetV2" });

    expect(edits).toBeDefined();
    expect(edits).toHaveLength(4);
    const byFile = edits!.reduce<Record<string, number>>((acc, e) => {
      acc[e.filePath] = (acc[e.filePath] ?? 0) + 1;
      return acc;
    }, {});
    expect(byFile[ENTRY_PATH]).toBe(2);
    expect(byFile[FRAGMENT_PATH]).toBe(2);
  });

  test("cross-file ref edit ranges cover only the final pointer segment of './x.yaml#/...' refs", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: ENTRY_PATH, position, newName: "PetV2" });

    const fragmentEdits = edits!.filter((e) => e.filePath === FRAGMENT_PATH);
    expect(fragmentEdits).toHaveLength(2);
    for (const edit of fragmentEdits) {
      const line = FRAGMENT_TEXT.split("\n")[edit.range.start.line]!;
      expect(line).toContain("../openapi.yaml#/components/schemas/Pet");
      expect(textAt(FRAGMENT_TEXT, edit.range)).toBe("Pet");
    }
  });

  test("rejects a name that collides with an existing component in the same section", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: ENTRY_PATH, position, newName: "Owner" });

    expect(edits).toBeUndefined();
  });

  test.each(["", "Pet/2", "Pet#x", "Pet~1"])("rejects an invalid new name: %p", async (newName) => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: ENTRY_PATH, position, newName });

    expect(edits).toBeUndefined();
  });

  test("renaming to the same name is a valid no-op (not treated as a collision with itself)", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: ENTRY_PATH, position, newName: "Pet" });

    expect(edits).toBeDefined();
    expect(edits).toHaveLength(4);
  });
});

describe("renameComponent with unsaved overlay content", () => {
  const dir = mkdtempSync(join(tmpdir(), "oasis-rename-overlay-"));
  const entryPath = join(dir, "openapi.yaml");

  // Disk content: no `$ref` to Pet at all, and Pet defined one line higher than in the overlay.
  const diskText = `openapi: 3.1.0
info:
  title: Test
  version: "1.0.0"
paths: {}
components:
  schemas:
    Pet:
      type: object
`;

  // Unsaved buffer: adds an operation with a $ref to Pet, shifting Pet's definition further down.
  // Only present in the overlay, never written to disk.
  const overlayText = `openapi: 3.1.0
info:
  title: Test
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
components:
  schemas:
    Pet:
      type: object
`;

  writeFileSync(entryPath, diskText, "utf-8");

  afterAll(() => {
    // Best-effort cleanup; not load-bearing for the test result.
  });

  test("resolves positions and produces edits against the unsaved buffer, not disk content", async () => {
    const fs = new OverlayFileSystem((path) => (path === entryPath ? overlayText : undefined));
    const ctx = createServerContext(fs);

    const position = positionOf(overlayText, "#/components/schemas/Pet");
    const edits = await renameComponent(ctx, { path: entryPath, position, newName: "PetV2" });

    expect(edits).toBeDefined();
    expect(edits).toHaveLength(2);
    for (const edit of edits!) {
      expect(edit.filePath).toBe(entryPath);
      expect(edit.newText).toBe("PetV2");
      expect(textAt(overlayText, edit.range)).toBe("Pet");
    }
  });
});

describe("renameComponent across multiple project entries", () => {
  async function multiEntryContext() {
    const ctx = createServerContext(new InMemoryFileSystem(multiEntryFiles()));
    await scanWorkspaceRootsForProjects(ctx, [MULTI_ROOT]);
    return ctx;
  }

  test("a component in a file $ref'd by two entries: rename rewrites the $ref in BOTH entry docs", async () => {
    const ctx = await multiEntryContext();
    const position = positionOf(SHARED_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: SHARED_PATH, position, newName: "PetV2" });

    expect(edits).toBeDefined();
    for (const edit of edits!) expect(edit.newText).toBe("PetV2");

    const files = new Set(edits!.map((e) => e.filePath));
    // The definition (shared.yaml) plus the referencing $ref in each of the two entries.
    expect(files).toEqual(new Set([SHARED_PATH, ENTRY_A_PATH, ENTRY_B_PATH]));
    expect(edits!.filter((e) => e.filePath === ENTRY_A_PATH)).toHaveLength(1);
    expect(edits!.filter((e) => e.filePath === ENTRY_B_PATH)).toHaveLength(1);
    // The shared file, reachable from both graphs, is still edited exactly once (deduped).
    expect(edits!.filter((e) => e.filePath === SHARED_PATH)).toHaveLength(1);

    expect(textAt(ENTRY_A_TEXT, edits!.find((e) => e.filePath === ENTRY_A_PATH)!.range)).toBe("Pet");
    expect(textAt(ENTRY_B_TEXT, edits!.find((e) => e.filePath === ENTRY_B_PATH)!.range)).toBe("Pet");
  });
});
