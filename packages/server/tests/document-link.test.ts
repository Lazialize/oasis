import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { getDocumentLinks } from "../src/handlers/document-link.ts";
import { scanWorkspaceRootsForProjects } from "../src/project.ts";
import { createServerContext } from "../src/workspace.ts";
import { ENTRY_PATH, ENTRY_TEXT, FRAGMENT_PATH, FRAGMENT_TEXT, ROOT, refsFixtureFiles } from "./refs-fixtures.ts";

async function contextWithProject() {
  const ctx = createServerContext(new InMemoryFileSystem(refsFixtureFiles()));
  await scanWorkspaceRootsForProjects(ctx, [ROOT]);
  return ctx;
}

describe("getDocumentLinks", () => {
  test("cross-file $ref with a fragment links only the file-path portion", async () => {
    const ctx = await contextWithProject();

    const links = await getDocumentLinks(ctx, { path: FRAGMENT_PATH });

    // FRAGMENT_TEXT has two refs to '../openapi.yaml#/components/schemas/Pet'.
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.targetPath).toBe(ENTRY_PATH);
      expect(FRAGMENT_TEXT.slice(link.range.startOffset, link.range.endOffset)).toBe("../openapi.yaml");
    }
  });

  test("cross-file $ref without a fragment links the whole path value, and same-document refs are skipped", async () => {
    const ctx = await contextWithProject();

    const links = await getDocumentLinks(ctx, { path: ENTRY_PATH });

    // ENTRY_TEXT has one cross-file ref ('./paths/pets.yaml') and one same-document ref
    // ('#/components/schemas/Pet'); only the cross-file one should produce a link.
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.targetPath).toBe(FRAGMENT_PATH);
    expect(ENTRY_TEXT.slice(link.range.startOffset, link.range.endOffset)).toBe("./paths/pets.yaml");
  });

  test("double-quoted $ref values link only the path portion, excluding the fragment", async () => {
    const path = "/repo/entry.yaml";
    const fragPath = "/repo/paths/pets.yaml";
    const text = [
      "openapi: 3.1.0",
      "info:",
      "  title: Test API",
      '  version: "1.0.0"',
      "paths:",
      "  /pets:",
      '    $ref: "./paths/pets.yaml#/get"',
      "",
    ].join("\n");
    const fragText = ["get:", "  operationId: listPets", "  responses:", "    '200':", "      description: OK", ""].join("\n");

    const ctx = createServerContext(new InMemoryFileSystem({ [path]: text, [fragPath]: fragText }));
    const links = await getDocumentLinks(ctx, { path });

    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.targetPath).toBe(fragPath);
    expect(text.slice(link.range.startOffset, link.range.endOffset)).toBe("./paths/pets.yaml");
  });

  test("URL $ref values are skipped", async () => {
    const path = "/repo/entry.yaml";
    const text = [
      "openapi: 3.1.0",
      "info:",
      "  title: Test API",
      '  version: "1.0.0"',
      "paths:",
      "  /pets:",
      '    $ref: "https://example.com/shared.yaml#/components/schemas/Pet"',
      "",
    ].join("\n");

    const ctx = createServerContext(new InMemoryFileSystem({ [path]: text }));
    const links = await getDocumentLinks(ctx, { path });

    expect(links).toEqual([]);
  });

  test("an unresolvable relative path still produces a link (target existence is not checked)", async () => {
    const path = "/repo/entry.yaml";
    const text = [
      "openapi: 3.1.0",
      "info:",
      "  title: Test API",
      '  version: "1.0.0"',
      "paths:",
      "  /pets:",
      "    $ref: './missing.yaml#/get'",
      "",
    ].join("\n");

    const ctx = createServerContext(new InMemoryFileSystem({ [path]: text }));
    const links = await getDocumentLinks(ctx, { path });

    expect(links).toHaveLength(1);
    expect(links[0]!.targetPath).toBe("/repo/missing.yaml");
  });
});
