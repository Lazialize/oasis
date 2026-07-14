import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import type { Diagnostic as LspDiagnostic } from "vscode-languageserver";
import { loadProjectAtPath } from "../src/project.ts";
import { createValidationRunner } from "../src/validation.ts";
import { createServerContext } from "../src/workspace.ts";
import type { ServerContext } from "../src/workspace.ts";

/**
 * Issue #48: LSP diagnostics are keyed only by URI, so a file shared by two project entries must
 * be published as the merged, deduplicated union of every entry's contribution — and unloading one
 * entry must remove only that entry's diagnostics for the shared file.
 */

const CONFIG_A = "/w/a/oasis.config.jsonc";
const CONFIG_B = "/w/b/oasis.config.jsonc";
const ENTRY_A = "/w/a/a.yaml";
const ENTRY_B = "/w/b/b.yaml";
const SHARED = "/w/shared/pets.yaml";

// The shared path-item fragment is missing both `tags` and `description` on its operation. Config A
// keeps only `operation/description` on; config B keeps only `operation/tags` on — so each entry
// contributes a *different* diagnostic to the same shared file.
const SHARED_TEXT = `get:
  operationId: listPets
  responses:
    '200':
      description: OK
`;

function entryText(title: string): string {
  return `openapi: 3.1.0
info:
  title: ${title}
  version: "1.0.0"
paths:
  /pets:
    $ref: '../shared/pets.yaml'
`;
}

function sharedProjectFiles(): Record<string, string> {
  return {
    [CONFIG_A]: JSON.stringify({
      entries: ["a.yaml"],
      lint: { rules: { "operation/tags": "off", "operation/success-response": "off" } },
    }),
    [CONFIG_B]: JSON.stringify({
      entries: ["b.yaml"],
      lint: { rules: { "operation/description": "off", "operation/success-response": "off" } },
    }),
    [ENTRY_A]: entryText("A"),
    [ENTRY_B]: entryText("B"),
    [SHARED]: SHARED_TEXT,
  };
}

interface Harness {
  ctx: ServerContext;
  published: Map<string, LspDiagnostic[]>;
  runner: ReturnType<typeof createValidationRunner>;
}

async function setupSharedProjects(): Promise<Harness> {
  const ctx = createServerContext(new InMemoryFileSystem(sharedProjectFiles()));
  await loadProjectAtPath(ctx, CONFIG_A);
  await loadProjectAtPath(ctx, CONFIG_B);
  const published = new Map<string, LspDiagnostic[]>();
  const runner = createValidationRunner(ctx, {
    publish: (filePath, diagnostics) => published.set(filePath, diagnostics),
  });
  return { ctx, published, runner };
}

function codes(diagnostics: LspDiagnostic[] | undefined): string[] {
  return (diagnostics ?? []).map((d) => String(d.code)).sort();
}

describe("createValidationRunner (issue #48: shared-file merging)", () => {
  test("a file shared by two entries gets the merged union of both entries' diagnostics", async () => {
    const { runner, published } = await setupSharedProjects();
    await runner.validate(ENTRY_A);
    expect(codes(published.get(SHARED))).toEqual(["operation/description"]);

    await runner.validate(ENTRY_B);
    // Entry B's publish must not clobber entry A's contribution to the shared file.
    expect(codes(published.get(SHARED))).toEqual(["operation/description", "operation/tags"]);
  });

  test("merged result does not depend on validation order", async () => {
    const { runner, published } = await setupSharedProjects();
    await runner.validate(ENTRY_B);
    await runner.validate(ENTRY_A);
    expect(codes(published.get(SHARED))).toEqual(["operation/description", "operation/tags"]);
  });

  test("re-validating one entry keeps the sibling's contribution", async () => {
    const { runner, published } = await setupSharedProjects();
    await runner.validate(ENTRY_A);
    await runner.validate(ENTRY_B);
    await runner.validate(ENTRY_A); // e.g. an edit to a.yaml re-validated only entry A
    expect(codes(published.get(SHARED))).toEqual(["operation/description", "operation/tags"]);
  });

  test("clearing either entry removes only its own contribution", async () => {
    const { runner, published } = await setupSharedProjects();
    await runner.validate(ENTRY_A);
    await runner.validate(ENTRY_B);

    runner.clearEntry(ENTRY_A);
    expect(codes(published.get(SHARED))).toEqual(["operation/tags"]);
    // Entry A's own file is cleared entirely (no other entry contributes to it).
    expect(published.get(ENTRY_A)).toEqual([]);

    runner.clearEntry(ENTRY_B);
    expect(published.get(SHARED)).toEqual([]);
    expect(published.get(ENTRY_B)).toEqual([]);
  });

  test("identical diagnostics from two entries are deduplicated, not doubled", async () => {
    // Same shared fragment, but both configs leave `operation/description` on: both entries report
    // the identical diagnostic against the shared file.
    const files = sharedProjectFiles();
    files[CONFIG_B] = JSON.stringify({
      entries: ["b.yaml"],
      lint: { rules: { "operation/tags": "off", "operation/success-response": "off" } },
    });
    const ctx = createServerContext(new InMemoryFileSystem(files));
    await loadProjectAtPath(ctx, CONFIG_A);
    await loadProjectAtPath(ctx, CONFIG_B);
    const published = new Map<string, LspDiagnostic[]>();
    const runner = createValidationRunner(ctx, { publish: (f, d) => published.set(f, d) });

    await runner.validate(ENTRY_A);
    await runner.validate(ENTRY_B);
    expect(codes(published.get(SHARED))).toEqual(["operation/description"]);
  });

  test("republishFile publishes the current merged set for a single file", async () => {
    const { runner, published } = await setupSharedProjects();
    runner.republishFile("/w/never-seen.yaml");
    expect(published.get("/w/never-seen.yaml")).toEqual([]);

    await runner.validate(ENTRY_A);
    published.clear();
    runner.republishFile(SHARED);
    expect(codes(published.get(SHARED))).toEqual(["operation/description"]);
  });
});
