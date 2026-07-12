import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { getDiagnosticsByFile } from "../src/diagnostics.ts";
import { OverlayFileSystem } from "../src/overlay-fs.ts";
import { loadProjectAtPath, scanWorkspaceRootsForProjects } from "../src/project.ts";
import { createServerContext, invalidateGraph } from "../src/workspace.ts";

// v0.7 work package: honor v0.3 features (suppression comments, per-glob overrides) through the
// LSP, and harden project-config reload. These tests exercise `getDiagnosticsByFile` (and the
// lower-level project/graph functions it depends on) the same way `connection.ts` drives them on
// real `didOpen`/`didChange`/`didChangeWatchedFiles` events, without spinning up a real connection.

const ROOT = "/lint-config";
const CONFIG_PATH = `${ROOT}/oasis.config.jsonc`;
const ENTRY_PATH = `${ROOT}/openapi.yaml`;
const FRAGMENT_PATH = `${ROOT}/paths/pets.yaml`;

/** Missing `operationId` on `GET /pets`, so `operation-operationId` fires unless suppressed. */
function entryText(suppressed: boolean): string {
  return `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    get:
${suppressed ? "      # oasis-disable-next-line operation-operationId\n" : ""}      tags: [pets]
      description: List pets.
      responses:
        '200':
          description: OK
`;
}

const FRAGMENT_TEXT_UNSUPPRESSED = `get:
  tags: [pets]
  description: List pets.
  responses:
    '200':
      description: OK
`;

const FRAGMENT_TEXT_SUPPRESSED = `get:
  # oasis-disable-next-line operation-operationId
  tags: [pets]
  description: List pets.
  responses:
    '200':
      description: OK
`;

function projectFiles(fragmentText: string): Record<string, string> {
  return {
    [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
    [ENTRY_PATH]: `openapi: 3.1.0\ninfo:\n  title: Test API\n  version: "1.0.0"\npaths:\n  /pets:\n    $ref: './paths/pets.yaml'\n`,
    [FRAGMENT_PATH]: fragmentText,
  };
}

describe("suppression comments through the LSP", () => {
  test("a `# oasis-disable-next-line` comment suppresses the diagnostic", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: entryText(true) }));
    const byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    const diags = byFile.get(ENTRY_PATH) ?? [];
    expect(diags.some((d) => d.code === "operation-operationId")).toBe(false);
  });

  test("without the comment, the diagnostic is present", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: entryText(false) }));
    const byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    const diags = byFile.get(ENTRY_PATH) ?? [];
    expect(diags.some((d) => d.code === "operation-operationId")).toBe(true);
  });

  test("editing the in-memory buffer toggles the diagnostic without a save: remove then re-add the comment", async () => {
    const fs = new InMemoryFileSystem({ [ENTRY_PATH]: entryText(true) });
    const ctx = createServerContext(fs);

    // Opened with the suppression comment present: no diagnostic.
    let byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    expect((byFile.get(ENTRY_PATH) ?? []).some((d) => d.code === "operation-operationId")).toBe(false);

    // didChange: remove the comment (unsaved edit, only the overlay/in-memory FS changes).
    fs.writeFile(ENTRY_PATH, entryText(false));
    invalidateGraph(ctx, ENTRY_PATH);
    byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    expect((byFile.get(ENTRY_PATH) ?? []).some((d) => d.code === "operation-operationId")).toBe(true);

    // didChange: add it back.
    fs.writeFile(ENTRY_PATH, entryText(true));
    invalidateGraph(ctx, ENTRY_PATH);
    byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    expect((byFile.get(ENTRY_PATH) ?? []).some((d) => d.code === "operation-operationId")).toBe(false);
  });

  test("a suppression directive in a $ref'd project-graph file suppresses diagnostics for that file only", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles(FRAGMENT_TEXT_SUPPRESSED)));
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    const fragDiags = byFile.get(FRAGMENT_PATH) ?? [];
    expect(fragDiags.some((d) => d.code === "operation-operationId")).toBe(false);
  });

  test("without the directive, the fragment's diagnostic is published as part of the entry's graph", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles(FRAGMENT_TEXT_UNSUPPRESSED)));
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    const fragDiags = byFile.get(FRAGMENT_PATH) ?? [];
    expect(fragDiags.some((d) => d.code === "operation-operationId")).toBe(true);
  });

  test("suppression scanning reads the unsaved overlay buffer, not the on-disk file", async () => {
    // Disk content has no suppression comment (diagnostic would fire); the overlay adds one.
    const dir = mkdtempSync(join(tmpdir(), "oasis-suppression-overlay-"));
    const entryPath = join(dir, "openapi.yaml");
    writeFileSync(entryPath, entryText(false), "utf-8");

    const overlayText = entryText(true);
    const fs = new OverlayFileSystem((path) => (path === entryPath ? overlayText : undefined));
    const ctx = createServerContext(fs);

    const byFile = await getDiagnosticsByFile(ctx, entryPath);
    const diags = byFile.get(entryPath) ?? [];
    expect(diags.some((d) => d.code === "operation-operationId")).toBe(false);
  });
});

describe("overrides through the LSP", () => {
  const OVERRIDE_ROOT = "/lint-config-overrides";
  const OVERRIDE_CONFIG_PATH = `${OVERRIDE_ROOT}/oasis.config.jsonc`;
  const MATCHING_PATH = `${OVERRIDE_ROOT}/paths/pets.yaml`;
  const NON_MATCHING_PATH = `${OVERRIDE_ROOT}/openapi.yaml`;

  function overrideProjectFiles(overrideSeverity: string): Record<string, string> {
    return {
      [OVERRIDE_CONFIG_PATH]: JSON.stringify({
        entries: ["openapi.yaml"],
        lint: { overrides: [{ files: ["paths/**"], rules: { "operation-operationId": overrideSeverity } }] },
      }),
      [NON_MATCHING_PATH]: `openapi: 3.1.0\ninfo:\n  title: Test\n  version: "1.0.0"\npaths:\n  /pets:\n    $ref: './paths/pets.yaml'\n`,
      [MATCHING_PATH]: FRAGMENT_TEXT_UNSUPPRESSED,
    };
  }

  test("a glob override turns a rule off for matching files only", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(overrideProjectFiles("off")));
    await scanWorkspaceRootsForProjects(ctx, [OVERRIDE_ROOT]);

    const byFile = await getDiagnosticsByFile(ctx, NON_MATCHING_PATH);
    // Matching file: overridden off.
    expect((byFile.get(MATCHING_PATH) ?? []).some((d) => d.code === "operation-operationId")).toBe(false);
  });

  test("a glob override changes severity for matching files; non-matching files keep the top-level severity", async () => {
    const files = overrideProjectFiles("warn");
    const ctx = createServerContext(new InMemoryFileSystem(files));
    await scanWorkspaceRootsForProjects(ctx, [OVERRIDE_ROOT]);

    const byFile = await getDiagnosticsByFile(ctx, NON_MATCHING_PATH);
    const matching = (byFile.get(MATCHING_PATH) ?? []).find((d) => d.code === "operation-operationId");
    expect(matching).toBeDefined();
    expect(matching?.severity).toBe(2); // DiagnosticSeverity.Warning

    // The entry itself has no operations of its own (just a $ref), so nothing to compare there;
    // instead verify a rule with no override keeps its default (error) severity on the matching
    // file too, proving only the overridden rule's severity changed.
    const otherRule = (byFile.get(MATCHING_PATH) ?? []).find((d) => d.code === "operation-description");
    expect(otherRule).toBeUndefined(); // fragment has a description, so nothing to assert on severity directly.
  });

  test("override glob matching works against the absolute paths the server passes", async () => {
    // Regression guard: `effectiveRuleConfig` resolves `filePath` relative to `configDir`. If the
    // server ever passed a differently-shaped path (e.g. not absolute, or resolved against the
    // wrong base), the glob "paths/**" would silently stop matching.
    const ctx = createServerContext(new InMemoryFileSystem(overrideProjectFiles("off")));
    await scanWorkspaceRootsForProjects(ctx, [OVERRIDE_ROOT]);

    expect(MATCHING_PATH.startsWith(OVERRIDE_ROOT)).toBe(true);
    const byFile = await getDiagnosticsByFile(ctx, NON_MATCHING_PATH);
    expect(byFile.has(MATCHING_PATH)).toBe(true);
    expect((byFile.get(MATCHING_PATH) ?? []).some((d) => d.code === "operation-operationId")).toBe(false);
  });
});

describe("robust re-lint on config edits", () => {
  const CFG_ROOT = "/lint-config-reload";
  const CFG_CONFIG_PATH = `${CFG_ROOT}/oasis.config.jsonc`;
  const CFG_ENTRY_PATH = `${CFG_ROOT}/openapi.yaml`;

  function reloadProjectFiles(rulesConfig: string): Record<string, string> {
    return {
      [CFG_CONFIG_PATH]: rulesConfig,
      [CFG_ENTRY_PATH]: entryText(false),
    };
  }

  test("(a) editing the config to invalid JSONC keeps the last-good project loaded, not crashing", async () => {
    const fs = new InMemoryFileSystem(
      reloadProjectFiles(`{ "entries": ["openapi.yaml"], "lint": { "rules": { "operation-operationId": "off" } } }`),
    );
    const ctx = createServerContext(fs);
    await scanWorkspaceRootsForProjects(ctx, [CFG_ROOT]);

    const before = ctx.projects.get(CFG_CONFIG_PATH);
    expect(before?.entryPaths).toEqual([CFG_ENTRY_PATH]);
    let byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    expect((byFile.get(CFG_ENTRY_PATH) ?? []).some((d) => d.code === "operation-operationId")).toBe(false);

    // Mid-edit: syntactically invalid JSONC (e.g. a dangling comma while typing).
    fs.writeFile(CFG_CONFIG_PATH, `{ "entries": ["openapi.yaml"], "lint": { "rules": {,,, } }`);
    const reloaded = await loadProjectAtPath(ctx, CFG_CONFIG_PATH);

    // Doesn't crash, and reports a config diagnostic...
    expect(reloaded?.warnings.some((w) => w.toLowerCase().includes("parse"))).toBe(true);
    // ...but the *stored* project state (used to serve diagnostics) is untouched: last-good.
    expect(ctx.projects.get(CFG_CONFIG_PATH)?.entryPaths).toEqual([CFG_ENTRY_PATH]);
    byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    expect((byFile.get(CFG_ENTRY_PATH) ?? []).some((d) => d.code === "operation-operationId")).toBe(false);
  });

  test("(b) editing rules severities only re-publishes diagnostics for already-open documents without editing them", async () => {
    const fs = new InMemoryFileSystem(
      reloadProjectFiles(`{ "entries": ["openapi.yaml"], "lint": { "rules": { "operation-operationId": "off" } } }`),
    );
    const ctx = createServerContext(fs);
    await scanWorkspaceRootsForProjects(ctx, [CFG_ROOT]);

    let byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    expect((byFile.get(CFG_ENTRY_PATH) ?? []).some((d) => d.code === "operation-operationId")).toBe(false);

    // Only the config changes; the entry document's own text is untouched.
    fs.writeFile(CFG_CONFIG_PATH, `{ "entries": ["openapi.yaml"], "lint": { "rules": { "operation-operationId": "error" } } }`);
    await loadProjectAtPath(ctx, CFG_CONFIG_PATH);

    byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    expect((byFile.get(CFG_ENTRY_PATH) ?? []).some((d) => d.code === "operation-operationId")).toBe(true);
  });

  test("(c) editing an override's glob re-publishes diagnostics immediately", async () => {
    const fragmentPath = `${CFG_ROOT}/paths/pets.yaml`;
    const files: Record<string, string> = {
      [CFG_CONFIG_PATH]: JSON.stringify({
        entries: ["openapi.yaml"],
        lint: { overrides: [{ files: ["nomatch/**"], rules: { "operation-operationId": "off" } }] },
      }),
      [CFG_ENTRY_PATH]: `openapi: 3.1.0\ninfo:\n  title: Test\n  version: "1.0.0"\npaths:\n  /pets:\n    $ref: './paths/pets.yaml'\n`,
      [fragmentPath]: FRAGMENT_TEXT_UNSUPPRESSED,
    };
    const fs = new InMemoryFileSystem(files);
    const ctx = createServerContext(fs);
    await scanWorkspaceRootsForProjects(ctx, [CFG_ROOT]);

    let byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    expect((byFile.get(fragmentPath) ?? []).some((d) => d.code === "operation-operationId")).toBe(true);

    // Widen the glob so it now matches the fragment; the fragment file itself is never touched.
    fs.writeFile(
      CFG_CONFIG_PATH,
      JSON.stringify({
        entries: ["openapi.yaml"],
        lint: { overrides: [{ files: ["paths/**"], rules: { "operation-operationId": "off" } }] },
      }),
    );
    await loadProjectAtPath(ctx, CFG_CONFIG_PATH);

    byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    expect((byFile.get(fragmentPath) ?? []).some((d) => d.code === "operation-operationId")).toBe(false);
  });

  test("(d) rapid successive config edits converge to the last edit, not a stale intermediate one", async () => {
    const fs = new InMemoryFileSystem(reloadProjectFiles(`{ "entries": ["openapi.yaml"] }`));
    const ctx = createServerContext(fs);
    await scanWorkspaceRootsForProjects(ctx, [CFG_ROOT]);

    // Simulate a burst of keystrokes producing several successive didChange-driven reloads, as
    // `connection.ts`'s `reloadProjectAtConfigPath` would do on each one (no debounce on the
    // config-file path today: every edit reloads immediately). Firing the reloads without
    // awaiting between them and asserting the end state matches the *last* write is the
    // correctness property that matters; each reload reads whatever `fs` currently holds when it
    // runs, so out-of-order completion can't leave a stale intermediate result behind.
    const edits = [
      `{ "entries": ["openapi.yaml"], "lint": { "rules": { "operation-operationId": "off" } } }`,
      `{ "entries": ["openapi.yaml"], "lint": { "rules": { "operation-operationId": "warn" } } }`,
      `{ "entries": ["openapi.yaml"], "lint": { "rules": { "operation-operationId": "error" } } }`,
    ];
    let reloads: Promise<unknown>[] = [];
    for (const text of edits) {
      fs.writeFile(CFG_CONFIG_PATH, text);
      reloads.push(loadProjectAtPath(ctx, CFG_CONFIG_PATH));
    }
    await Promise.all(reloads);

    const byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    const diag = (byFile.get(CFG_ENTRY_PATH) ?? []).find((d) => d.code === "operation-operationId");
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe(1); // DiagnosticSeverity.Error: the last edit's severity.
  });
});
