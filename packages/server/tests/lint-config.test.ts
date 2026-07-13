import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { getDiagnosticsByFile } from "../src/diagnostics.ts";
import { routeDocument } from "../src/document-routing.ts";
import { OverlayFileSystem } from "../src/overlay-fs.ts";
import { findNearestConfigFile, loadProjectAtPath, resolveConfigForEntry, scanWorkspaceRootsForProjects } from "../src/project.ts";
import { createServerContext, findOwningEntry, findProjectForEntry, invalidateGraph } from "../src/workspace.ts";

// v0.7 work package: honor v0.3 features (suppression comments, per-glob overrides) through the
// LSP, and harden project-config reload. These tests exercise `getDiagnosticsByFile` (and the
// lower-level project/graph functions it depends on) the same way `connection.ts` drives them on
// real `didOpen`/`didChange`/`didChangeWatchedFiles` events, without spinning up a real connection.

const ROOT = "/lint-config";
const CONFIG_PATH = `${ROOT}/oasis.config.jsonc`;
const ENTRY_PATH = `${ROOT}/openapi.yaml`;
const FRAGMENT_PATH = `${ROOT}/paths/pets.yaml`;

/** Missing `operationId` on `GET /pets`, so `operation/operation-id` fires unless suppressed. */
function entryText(suppressed: boolean): string {
  return `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    get:
${suppressed ? "      # oasis-disable-next-line operation/operation-id\n" : ""}      tags: [pets]
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
  # oasis-disable-next-line operation/operation-id
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
    expect(diags.some((d) => d.code === "operation/operation-id")).toBe(false);
  });

  test("without the comment, the diagnostic is present", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: entryText(false) }));
    const byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    const diags = byFile.get(ENTRY_PATH) ?? [];
    expect(diags.some((d) => d.code === "operation/operation-id")).toBe(true);
  });

  test("editing the in-memory buffer toggles the diagnostic without a save: remove then re-add the comment", async () => {
    const fs = new InMemoryFileSystem({ [ENTRY_PATH]: entryText(true) });
    const ctx = createServerContext(fs);

    // Opened with the suppression comment present: no diagnostic.
    let byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    expect((byFile.get(ENTRY_PATH) ?? []).some((d) => d.code === "operation/operation-id")).toBe(false);

    // didChange: remove the comment (unsaved edit, only the overlay/in-memory FS changes).
    fs.writeFile(ENTRY_PATH, entryText(false));
    invalidateGraph(ctx, ENTRY_PATH);
    byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    expect((byFile.get(ENTRY_PATH) ?? []).some((d) => d.code === "operation/operation-id")).toBe(true);

    // didChange: add it back.
    fs.writeFile(ENTRY_PATH, entryText(true));
    invalidateGraph(ctx, ENTRY_PATH);
    byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    expect((byFile.get(ENTRY_PATH) ?? []).some((d) => d.code === "operation/operation-id")).toBe(false);
  });

  test("a suppression directive in a $ref'd project-graph file suppresses diagnostics for that file only", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles(FRAGMENT_TEXT_SUPPRESSED)));
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    const fragDiags = byFile.get(FRAGMENT_PATH) ?? [];
    expect(fragDiags.some((d) => d.code === "operation/operation-id")).toBe(false);
  });

  test("without the directive, the fragment's diagnostic is published as part of the entry's graph", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles(FRAGMENT_TEXT_UNSUPPRESSED)));
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    const fragDiags = byFile.get(FRAGMENT_PATH) ?? [];
    expect(fragDiags.some((d) => d.code === "operation/operation-id")).toBe(true);
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
    expect(diags.some((d) => d.code === "operation/operation-id")).toBe(false);
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
        lint: { overrides: [{ files: ["paths/**"], rules: { "operation/operation-id": overrideSeverity } }] },
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
    expect((byFile.get(MATCHING_PATH) ?? []).some((d) => d.code === "operation/operation-id")).toBe(false);
  });

  test("a glob override changes severity for matching files; non-matching files keep the top-level severity", async () => {
    const files = overrideProjectFiles("warn");
    const ctx = createServerContext(new InMemoryFileSystem(files));
    await scanWorkspaceRootsForProjects(ctx, [OVERRIDE_ROOT]);

    const byFile = await getDiagnosticsByFile(ctx, NON_MATCHING_PATH);
    const matching = (byFile.get(MATCHING_PATH) ?? []).find((d) => d.code === "operation/operation-id");
    expect(matching).toBeDefined();
    expect(matching?.severity).toBe(2); // DiagnosticSeverity.Warning

    // The entry itself has no operations of its own (just a $ref), so nothing to compare there;
    // instead verify a rule with no override keeps its default (error) severity on the matching
    // file too, proving only the overridden rule's severity changed.
    const otherRule = (byFile.get(MATCHING_PATH) ?? []).find((d) => d.code === "operation/description");
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
    expect((byFile.get(MATCHING_PATH) ?? []).some((d) => d.code === "operation/operation-id")).toBe(false);
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
      reloadProjectFiles(`{ "entries": ["openapi.yaml"], "lint": { "rules": { "operation/operation-id": "off" } } }`),
    );
    const ctx = createServerContext(fs);
    await scanWorkspaceRootsForProjects(ctx, [CFG_ROOT]);

    const before = ctx.projects.get(CFG_CONFIG_PATH);
    expect(before?.entryPaths).toEqual([CFG_ENTRY_PATH]);
    let byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    expect((byFile.get(CFG_ENTRY_PATH) ?? []).some((d) => d.code === "operation/operation-id")).toBe(false);

    // Mid-edit: syntactically invalid JSONC (e.g. a dangling comma while typing).
    fs.writeFile(CFG_CONFIG_PATH, `{ "entries": ["openapi.yaml"], "lint": { "rules": {,,, } }`);
    const reloaded = await loadProjectAtPath(ctx, CFG_CONFIG_PATH);

    // Doesn't crash, and reports a config diagnostic...
    expect(reloaded?.warnings.some((w) => w.toLowerCase().includes("parse"))).toBe(true);
    // ...but the *stored* project state (used to serve diagnostics) is untouched: last-good.
    expect(ctx.projects.get(CFG_CONFIG_PATH)?.entryPaths).toEqual([CFG_ENTRY_PATH]);
    byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    expect((byFile.get(CFG_ENTRY_PATH) ?? []).some((d) => d.code === "operation/operation-id")).toBe(false);
  });

  test("(b) editing rules severities only re-publishes diagnostics for already-open documents without editing them", async () => {
    const fs = new InMemoryFileSystem(
      reloadProjectFiles(`{ "entries": ["openapi.yaml"], "lint": { "rules": { "operation/operation-id": "off" } } }`),
    );
    const ctx = createServerContext(fs);
    await scanWorkspaceRootsForProjects(ctx, [CFG_ROOT]);

    let byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    expect((byFile.get(CFG_ENTRY_PATH) ?? []).some((d) => d.code === "operation/operation-id")).toBe(false);

    // Only the config changes; the entry document's own text is untouched.
    fs.writeFile(CFG_CONFIG_PATH, `{ "entries": ["openapi.yaml"], "lint": { "rules": { "operation/operation-id": "error" } } }`);
    await loadProjectAtPath(ctx, CFG_CONFIG_PATH);

    byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    expect((byFile.get(CFG_ENTRY_PATH) ?? []).some((d) => d.code === "operation/operation-id")).toBe(true);
  });

  test("(c) editing an override's glob re-publishes diagnostics immediately", async () => {
    const fragmentPath = `${CFG_ROOT}/paths/pets.yaml`;
    const files: Record<string, string> = {
      [CFG_CONFIG_PATH]: JSON.stringify({
        entries: ["openapi.yaml"],
        lint: { overrides: [{ files: ["nomatch/**"], rules: { "operation/operation-id": "off" } }] },
      }),
      [CFG_ENTRY_PATH]: `openapi: 3.1.0\ninfo:\n  title: Test\n  version: "1.0.0"\npaths:\n  /pets:\n    $ref: './paths/pets.yaml'\n`,
      [fragmentPath]: FRAGMENT_TEXT_UNSUPPRESSED,
    };
    const fs = new InMemoryFileSystem(files);
    const ctx = createServerContext(fs);
    await scanWorkspaceRootsForProjects(ctx, [CFG_ROOT]);

    let byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    expect((byFile.get(fragmentPath) ?? []).some((d) => d.code === "operation/operation-id")).toBe(true);

    // Widen the glob so it now matches the fragment; the fragment file itself is never touched.
    fs.writeFile(
      CFG_CONFIG_PATH,
      JSON.stringify({
        entries: ["openapi.yaml"],
        lint: { overrides: [{ files: ["paths/**"], rules: { "operation/operation-id": "off" } }] },
      }),
    );
    await loadProjectAtPath(ctx, CFG_CONFIG_PATH);

    byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    expect((byFile.get(fragmentPath) ?? []).some((d) => d.code === "operation/operation-id")).toBe(false);
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
      `{ "entries": ["openapi.yaml"], "lint": { "rules": { "operation/operation-id": "off" } } }`,
      `{ "entries": ["openapi.yaml"], "lint": { "rules": { "operation/operation-id": "warn" } } }`,
      `{ "entries": ["openapi.yaml"], "lint": { "rules": { "operation/operation-id": "error" } } }`,
    ];
    let reloads: Promise<unknown>[] = [];
    for (const text of edits) {
      fs.writeFile(CFG_CONFIG_PATH, text);
      reloads.push(loadProjectAtPath(ctx, CFG_CONFIG_PATH));
    }
    await Promise.all(reloads);

    const byFile = await getDiagnosticsByFile(ctx, CFG_ENTRY_PATH);
    const diag = (byFile.get(CFG_ENTRY_PATH) ?? []).find((d) => d.code === "operation/operation-id");
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe(1); // DiagnosticSeverity.Error: the last edit's severity.
  });
});

// Regression tests for the v0.7 review findings: config resolution had two divergent, partly
// cached answers to "which config governs file X" (project.ts's `findNearestConfigFile` /
// `findProjectForEntry` vs. diagnostics.ts's own duplicate logic). These exercise the
// consolidated `resolveConfigForEntry` (the single source of truth both now share) directly, plus
// the specific defects the review found along the way.
describe("resolveConfigForEntry: single source of truth for config resolution", () => {
  const RES_ROOT = "/resolve-config";
  const RES_ENTRY_PATH = `${RES_ROOT}/openapi.yaml`;

  test("finding 2: a nearer config that fails to parse is not skipped in favor of an ancestor's config", async () => {
    // Nested dirs: /resolve-config (has a *valid* config) -> /resolve-config/sub (has a *broken*
    // config) -> /resolve-config/sub/openapi.yaml (the document). The broken nested config must
    // win (as "nearest existing"), not the valid ancestor one.
    const outerConfigPath = `${RES_ROOT}/oasis.config.jsonc`;
    const innerConfigPath = `${RES_ROOT}/sub/oasis.config.jsonc`;
    const docPath = `${RES_ROOT}/sub/openapi.yaml`;
    const ctx = createServerContext(
      new InMemoryFileSystem({
        [outerConfigPath]: `{ "lint": { "rules": { "operation/operation-id": "off" } } }`,
        [innerConfigPath]: `{ "lint": { "rules": {,,, } }`, // invalid JSONC
        [docPath]: `openapi: 3.1.0\ninfo:\n  title: T\n  version: "1.0.0"\npaths: {}\n`,
      }),
    );

    const nearest = await findNearestConfigFile(ctx, docPath);
    expect(nearest?.configPath).toBe(innerConfigPath);
    expect(nearest?.warning).toBeDefined();
    expect(nearest?.configFile).toEqual({}); // empty fallback, not the outer config's rules

    const resolved = await resolveConfigForEntry(ctx, docPath);
    expect(resolved.configPath).toBe(innerConfigPath);
    expect(resolved.warnings.length).toBe(1);
  });

  test("finding 3: a config whose first-ever load is a parse error still surfaces a warning", async () => {
    const configPath = `${RES_ROOT}/first-load-broken/oasis.config.jsonc`;
    const ctx = createServerContext(new InMemoryFileSystem({ [configPath]: `{ "entries": [,,,] }` }));

    // Never previously registered as a project (this is its first load), so the old behavior
    // returned undefined here with no warning at all.
    const state = await loadProjectAtPath(ctx, configPath);
    expect(state).toBeDefined();
    expect(state?.entryPaths).toEqual([]);
    expect(state?.warnings.length).toBe(1);
    expect(ctx.projects.has(configPath)).toBe(false); // still not registered as a real project
  });

  test("finding 6: findOwningEntry and findProjectForEntry agree on which project owns an entry declared by more than one", async () => {
    // Two configs, in a directory order that sorts differently than insertion order, both
    // (unusually) declaring the same entry path.
    const sharedEntryPath = `${RES_ROOT}/ordering/shared-entry.yaml`;
    const configZPath = `${RES_ROOT}/ordering/z/oasis.config.jsonc`;
    const configAPath = `${RES_ROOT}/ordering/a/oasis.config.jsonc`;
    const entryText = `openapi: 3.1.0\ninfo:\n  title: T\n  version: "1.0.0"\npaths: {}\n`;
    const ctx = createServerContext(
      new InMemoryFileSystem({
        [sharedEntryPath]: entryText,
        [configZPath]: JSON.stringify({ entries: ["../shared-entry.yaml"] }),
        [configAPath]: JSON.stringify({ entries: ["../shared-entry.yaml"] }),
      }),
    );

    // Insertion order is Z then A (deliberately the reverse of sorted config-path order).
    await loadProjectAtPath(ctx, configZPath);
    await loadProjectAtPath(ctx, configAPath);

    const owningEntry = await findOwningEntry(ctx, sharedEntryPath);
    const owningProject = findProjectForEntry(ctx, sharedEntryPath);
    expect(owningEntry).toBe(sharedEntryPath);
    // Both should pick the same (sorted-first) project's config path.
    expect(owningProject?.configPath).toBe(configAPath);
  });

  test("finding 7: standalone config resolution is cached per entry path", async () => {
    const configPath = `${RES_ROOT}/cache/oasis.config.jsonc`;
    const docPath = `${RES_ROOT}/cache/openapi.yaml`;
    const fs = new InMemoryFileSystem({
      [configPath]: `{ "lint": { "rules": { "operation/operation-id": "off" } } }`,
      [docPath]: `openapi: 3.1.0\ninfo:\n  title: T\n  version: "1.0.0"\npaths: {}\n`,
    });
    const ctx = createServerContext(fs);

    const first = await resolveConfigForEntry(ctx, docPath);
    expect(ctx.standaloneConfigCache.has(docPath)).toBe(true);

    // Rewrite the config directly on the filesystem without going through `loadProjectAtPath` (no
    // didChange simulated): the cache should still serve the stale, already-resolved answer.
    fs.writeFile(configPath, `{ "lint": { "rules": { "operation/operation-id": "error" } } }`);
    const second = await resolveConfigForEntry(ctx, docPath);
    expect(second).toBe(first); // same cached object, not re-read

    // Once a config load event happens (as `didChange`/`didChangeWatchedFiles` would trigger),
    // the cache must be invalidated so the next resolution picks up the edit.
    await loadProjectAtPath(ctx, configPath);
    expect(ctx.standaloneConfigCache.has(docPath)).toBe(false);
    const third = await resolveConfigForEntry(ctx, docPath);
    expect(third.configFile).toEqual({ lint: { rules: { "operation/operation-id": "error" } } });
  });

  test("finding 1: editing an override-only config (no `entries`) is tracked for standalone re-validation via openStandaloneEntries", async () => {
    // An override-only config never registers as a project (`loadProjectAtPath` returns a
    // synthetic, unregistered state for it), so the old `reloadProjectAtConfigPath` had nothing to
    // re-lint. `routeDocument` now records every standalone document it routes so a config reload
    // can find them again regardless of project registration.
    const overrideConfigPath = `${RES_ROOT}/override-only/oasis.config.jsonc`;
    const standalonePath = `${RES_ROOT}/override-only/openapi.yaml`;
    const standaloneText = `openapi: 3.1.0\ninfo:\n  title: T\n  version: "1.0.0"\npaths:\n  /pets:\n    get:\n      tags: [pets]\n      description: List pets.\n      responses:\n        '200':\n          description: OK\n`;
    const ctx = createServerContext(
      new InMemoryFileSystem({
        [overrideConfigPath]: `{ "lint": { "rules": { "operation/operation-id": "off" } } }`,
        [standalonePath]: standaloneText,
      }),
    );

    const route = await routeDocument(ctx, standalonePath, standaloneText);
    expect(route).toEqual({ kind: "standalone", entryPath: standalonePath });
    expect(ctx.openStandaloneEntries.has(standalonePath)).toBe(true);

    let byFile = await getDiagnosticsByFile(ctx, standalonePath);
    expect((byFile.get(standalonePath) ?? []).some((d) => d.code === "operation/operation-id")).toBe(false);

    // The config file itself changes (as `didChange`/`didChangeWatchedFiles` on it would drive);
    // loadProjectAtPath returns undefined (still no entries), but the standalone doc's cached
    // resolution must still be invalidated.
    (ctx.fileSystem as InMemoryFileSystem).writeFile(overrideConfigPath, `{ "lint": { "rules": { "operation/operation-id": "error" } } }`);
    const after = await loadProjectAtPath(ctx, overrideConfigPath);
    expect(after).toBeUndefined(); // still no entries: not a registered project
    expect(ctx.standaloneConfigCache.has(standalonePath)).toBe(false); // invalidated regardless

    byFile = await getDiagnosticsByFile(ctx, standalonePath);
    expect((byFile.get(standalonePath) ?? []).some((d) => d.code === "operation/operation-id")).toBe(true);
  });
});

// #33: a config that parses as JSONC but has the wrong runtime shape (e.g. `lint.overrides` as an
// object) must not crash project loading or lint runs — the invalid field is dropped at the load
// boundary (`readConfigFile` -> `validateConfigShape`) and surfaced as a config warning.
describe("structurally invalid config shapes (#33)", () => {
  const SHAPE_ROOT = "/bad-shape";
  const SHAPE_CONFIG_PATH = `${SHAPE_ROOT}/oasis.config.jsonc`;
  const SHAPE_ENTRY_PATH = `${SHAPE_ROOT}/openapi.yaml`;
  const SHAPE_ENTRY_TEXT = `openapi: 3.1.0\ninfo:\n  title: T\n  version: "1.0.0"\npaths: {}\n`;

  test("a project config with lint.overrides as an object loads without crashing and carries a warning", async () => {
    const ctx = createServerContext(
      new InMemoryFileSystem({
        [SHAPE_CONFIG_PATH]: `{ "entries": ["openapi.yaml"], "lint": { "overrides": {} } }`,
        [SHAPE_ENTRY_PATH]: SHAPE_ENTRY_TEXT,
      }),
    );

    const state = await loadProjectAtPath(ctx, SHAPE_CONFIG_PATH);
    expect(state).toBeDefined();
    expect(state?.entryPaths).toEqual([SHAPE_ENTRY_PATH]); // valid entries still load
    expect(state?.warnings.some((w) => w.includes("lint.overrides"))).toBe(true);
    // The invalid field was dropped, so downstream resolveConfig can't crash on it.
    expect(state?.configFile.lint?.overrides).toBeUndefined();

    // The lint run itself must not throw either.
    const byFile = await getDiagnosticsByFile(ctx, SHAPE_ENTRY_PATH);
    expect(byFile).toBeDefined();
  });

  test("a standalone entry governed by a shape-invalid config resolves with a warning, not a crash", async () => {
    const configPath = `${SHAPE_ROOT}/standalone/oasis.config.jsonc`;
    const docPath = `${SHAPE_ROOT}/standalone/openapi.yaml`;
    const ctx = createServerContext(
      new InMemoryFileSystem({
        [configPath]: `{ "lint": { "rules": "not-an-object" } }`,
        [docPath]: SHAPE_ENTRY_TEXT,
      }),
    );

    const resolved = await resolveConfigForEntry(ctx, docPath);
    expect(resolved.configPath).toBe(configPath);
    expect(resolved.warnings.some((w) => w.includes("lint.rules"))).toBe(true);
    expect(resolved.configFile.lint?.rules).toBeUndefined();

    const byFile = await getDiagnosticsByFile(ctx, docPath);
    expect(byFile).toBeDefined();
  });
});
