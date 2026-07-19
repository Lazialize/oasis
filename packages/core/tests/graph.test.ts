import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import { InMemoryFileSystem, NodeFileSystem } from "../src/filesystem.ts";
import { allDiagnostics, graphReferences, loadWorkspaceGraph } from "../src/graph.ts";
import { resolveRef } from "../src/ref.ts";

describe("entry path canonicalization (issue #25)", () => {
  test("a relative entry is loaded once, under its canonical path", async () => {
    const fs = new InMemoryFileSystem({
      "tmp-oasis/entry.yaml": [
        "openapi: 3.0.3",
        "info: { title: t, version: '1' }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Ref: { $ref: './other.yaml#/components/schemas/Thing' }",
      ].join("\n"),
      "tmp-oasis/other.yaml": [
        "components:",
        "  schemas:",
        "    Thing: { $ref: './entry.yaml#/components/schemas/Ref' }",
      ].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "tmp-oasis/entry.yaml");

    const canonicalEntry = pathResolve("tmp-oasis/entry.yaml");
    const canonicalOther = pathResolve("tmp-oasis/other.yaml");

    // Exactly two documents: the entry (once) and the other file — no duplicate identity.
    expect([...graph.documents.keys()].sort()).toEqual([canonicalEntry, canonicalOther].sort());
    expect(graph.documents.size).toBe(2);

    // The graph exposes the canonical entry path.
    expect(graph.entryPath).toBe(canonicalEntry);

    // The relative key must NOT appear.
    expect(graph.documents.has("tmp-oasis/entry.yaml")).toBe(false);
  });

  test("a two-file cycle reached from a relative entry yields a single cycle diagnostic", async () => {
    const fs = new InMemoryFileSystem({
      "tmp-oasis/a.yaml": "x: { $ref: './b.yaml#/y' }",
      "tmp-oasis/b.yaml": "y: { $ref: './a.yaml#/x' }",
    });

    const graph = await loadWorkspaceGraph(fs, "tmp-oasis/a.yaml");

    expect(graph.documents.size).toBe(2);
    const cycles = allDiagnostics(graph).filter((d) => d.code === "no-ref-cycle");
    expect(cycles.length).toBe(1);
  });

  test("a self reference from a relative entry does not duplicate the document", async () => {
    const fs = new InMemoryFileSystem({
      "tmp-oasis/self.yaml": [
        "openapi: 3.0.3",
        "info: { title: t, version: '1' }",
        "components:",
        "  schemas:",
        "    A: { type: object }",
        "    B: { $ref: './self.yaml#/components/schemas/A' }",
      ].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "tmp-oasis/self.yaml");

    expect(graph.documents.size).toBe(1);
    expect(graph.entryPath).toBe(pathResolve("tmp-oasis/self.yaml"));
    // A same-file self ref is not a cross-file cycle.
    expect(allDiagnostics(graph).filter((d) => d.code === "no-ref-cycle")).toEqual([]);
  });
});

describe("resolved-target cycle detection (issue #86)", () => {
  test("detects direct and indirect same-document cycles", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/direct.yaml": "A: { $ref: '#/A' }",
      "/virtual/indirect.yaml": [
        "A: { $ref: '#/B' }",
        "B: { $ref: '#/C' }",
        "C: { $ref: '#/A' }",
      ].join("\n"),
    });

    const direct = await loadWorkspaceGraph(fs, "/virtual/direct.yaml");
    const indirect = await loadWorkspaceGraph(fs, "/virtual/indirect.yaml");

    expect(direct.diagnostics.filter((d) => d.code === "no-ref-cycle")).toHaveLength(1);
    expect(indirect.diagnostics.filter((d) => d.code === "no-ref-cycle")).toHaveLength(1);
  });

  test("detects a cross-file target cycle at the closing reference", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/a.yaml": "A: { $ref: './b.yaml#/B' }",
      "/virtual/b.yaml": "B:\n  $ref: './a.yaml#/A'",
    });

    const graph = await loadWorkspaceGraph(fs, "/virtual/a.yaml");
    const cycles = graph.diagnostics.filter((d) => d.code === "no-ref-cycle");

    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.range.filePath).toBe("/virtual/b.yaml");
    expect(cycles[0]?.range.start.line).toBe(1);
    expect(cycles[0]?.range.start.character).toBe(8);
  });

  test("does not report mutual file dependencies whose target chains terminate", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/a.yaml": ["A: { $ref: './b.yaml#/B' }", "C: { type: string }"].join("\n"),
      "/virtual/b.yaml": ["B: { type: integer }", "X: { $ref: './a.yaml#/C' }"].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "/virtual/a.yaml");

    expect(graph.documents.size).toBe(2);
    expect(graph.diagnostics.filter((d) => d.code === "no-ref-cycle")).toEqual([]);
  });

  test("keeps aliased reference identities distinct between $id resource scopes", async () => {
    const fs = new InMemoryFileSystem({
      "/api/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    One:",
        "      $id: root.json",
        "      $defs:",
        "        Use: &shared { $ref: 'sub/next.json#/$defs/Use' }",
        "    Two:",
        "      $id: sub/next.json",
        "      $defs: { Use: *shared }",
      ].join("\n"),
      "/api/sub/sub/next.json": "$defs: { Use: { type: string } }\n",
    });

    const graph = await loadWorkspaceGraph(fs, "/api/entry.yaml");

    // The shared node is reached as S@root -> S@sub/next -> terminal. Collapsing those first two
    // identities to their common AST node would turn the first edge into a false self-cycle.
    expect([...graph.documents.keys()].sort()).toEqual([
      "/api/entry.yaml",
      "/api/sub/sub/next.json",
    ]);
    expect(graph.diagnostics.filter((d) => d.code === "no-ref-cycle")).toEqual([]);
  });

  test("keeps distinct owners of a scalar-aliased ref for cycle detection", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.1.0",
        "x-ref: &ref '#/components/schemas/A'",
        "components:",
        "  schemas:",
        "    B: { $ref: *ref }",
        "    A: { $ref: *ref }",
      ].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const entry = graph.documents.get("/virtual/entry.yaml")!;

    // Public semantic references remain deduplicated by source scalar and base, while the internal
    // cycle walk retains B -> A and the later A -> A owner occurrence that closes the cycle.
    expect(graphReferences(graph, entry).filter((ref) => ref.value.endsWith("/A"))).toHaveLength(1);
    expect(graph.diagnostics.filter((d) => d.code === "no-ref-cycle")).toHaveLength(1);
  });
});

describe("one-character URI scheme refs never touch the FileSystem (issue #151)", () => {
  /** In-memory FileSystem that records every path passed to readFile. */
  class RecordingFileSystem extends InMemoryFileSystem {
    readonly readFileCalls: string[] = [];

    override readFile(path: string): string {
      this.readFileCalls.push(path);
      return super.readFile(path);
    }
  }

  test("a $ref of x:thing is never routed to FileSystem.readFile and resolves as external", async () => {
    const fs = new RecordingFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.0.3",
        "info: { title: t, version: '1' }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Ext: { $ref: 'x:thing' }",
      ].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");

    // Only the entry document is ever read; `x:thing` must never reach readFile
    // (neither raw nor as a resolved sibling path like /virtual/x:thing).
    expect(fs.readFileCalls).toEqual(["/virtual/entry.yaml"]);
    expect(graph.documents.size).toBe(1);

    // Resolving the ref reports it as an unsupported external URI, not a missing file.
    const entryDoc = graph.documents.get("/virtual/entry.yaml")!;
    const result = resolveRef(graph, entryDoc, "x:thing");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected unresolved external ref");
    expect(result.diagnostic.code).toBe("no-unresolved-ref");
    expect(result.diagnostic.message).toContain("external");
    expect(fs.readFileCalls).toEqual(["/virtual/entry.yaml"]);
  });
});

describe("duplicate canonical JSON Schema resource identifiers (issue #178)", () => {
  function fixture(order: "a-then-b" | "b-then-a") {
    const refs = order === "a-then-b"
      ? ["    A: { $ref: './a.yaml' }", "    B: { $ref: './b.yaml' }"]
      : ["    B: { $ref: './b.yaml' }", "    A: { $ref: './a.yaml' }"];
    return new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        ...refs,
        "    Use: { $ref: 'https://schemas.example/dup#/$defs/Value' }",
      ].join("\n"),
      "/virtual/a.yaml": ["$id: https://schemas.example/dup", "$defs:", "  Value: { type: string }"].join("\n"),
      "/virtual/b.yaml": ["$id: https://schemas.example/dup", "$defs:", "  Value: { type: integer }"].join("\n"),
    });
  }

  test("two documents declaring the same canonical $id produce a duplicate-resource diagnostic", async () => {
    const graph = await loadWorkspaceGraph(fixture("a-then-b"), "/virtual/entry.yaml");

    const dupes = allDiagnostics(graph).filter((d) => d.code === "no-duplicate-schema-id");
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.message).toContain("https://schemas.example/dup");
    expect(dupes[0]?.message).toContain("/virtual/a.yaml");
    expect(dupes[0]?.message).toContain("/virtual/b.yaml");
    expect(dupes[0]?.severity).toBe("error");
  });

  test("a reference to the collided URI does not silently resolve to whichever document was indexed last", async () => {
    const graph = await loadWorkspaceGraph(fixture("a-then-b"), "/virtual/entry.yaml");
    const entry = graph.documents.get("/virtual/entry.yaml")!;

    const result = resolveRef(graph, entry, "https://schemas.example/dup#/$defs/Value");
    expect(result.ok).toBe(false);
  });

  test("reordering the referencing documents does not change the observable resolution result", async () => {
    const forward = await loadWorkspaceGraph(fixture("a-then-b"), "/virtual/entry.yaml");
    const reversed = await loadWorkspaceGraph(fixture("b-then-a"), "/virtual/entry.yaml");

    const forwardEntry = forward.documents.get("/virtual/entry.yaml")!;
    const reversedEntry = reversed.documents.get("/virtual/entry.yaml")!;

    const forwardResult = resolveRef(forward, forwardEntry, "https://schemas.example/dup#/$defs/Value");
    const reversedResult = resolveRef(reversed, reversedEntry, "https://schemas.example/dup#/$defs/Value");

    expect(forwardResult.ok).toBe(false);
    expect(reversedResult.ok).toBe(false);

    const forwardDupes = allDiagnostics(forward).filter((d) => d.code === "no-duplicate-schema-id");
    const reversedDupes = allDiagnostics(reversed).filter((d) => d.code === "no-duplicate-schema-id");
    expect(forwardDupes).toHaveLength(1);
    expect(reversedDupes).toHaveLength(1);
    // The diagnostic content is independent of load order.
    expect(forwardDupes[0]?.message).toBe(reversedDupes[0]?.message);
  });

  test("re-indexing the same document as generic then schema-aware is not a collision", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    A: { $ref: './shared.yaml' }",
        "    B: { $ref: './shared.yaml#/$defs/Value' }",
      ].join("\n"),
      "/virtual/shared.yaml": ["$id: https://schemas.example/shared", "$defs:", "  Value: { type: string }"].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");

    expect(allDiagnostics(graph).filter((d) => d.code === "no-duplicate-schema-id")).toEqual([]);
    const entry = graph.documents.get("/virtual/entry.yaml")!;
    const result = resolveRef(graph, entry, "https://schemas.example/shared#/$defs/Value");
    expect(result.ok).toBe(true);
  });

  test("a duplicate $id nested as an embedded resource is also detected", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    A: { $ref: './a.yaml' }",
        "    B: { $ref: './b.yaml' }",
        "    Use: { $ref: 'https://schemas.example/embedded#/$defs/Value' }",
      ].join("\n"),
      "/virtual/a.yaml": [
        "type: object",
        "properties:",
        "  nested:",
        "    $id: https://schemas.example/embedded",
        "    $defs:",
        "      Value: { type: string }",
      ].join("\n"),
      "/virtual/b.yaml": [
        "$id: https://schemas.example/embedded",
        "$defs:",
        "  Value: { type: integer }",
      ].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");

    const dupes = allDiagnostics(graph).filter((d) => d.code === "no-duplicate-schema-id");
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.message).toContain("https://schemas.example/embedded");
  });
});

describe("physical file identity across symlinks and case aliases (issue #153)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "oasis-graph-canon-"));
    dirs.push(dir);
    return dir;
  }

  test("an entry reached through a symlinked directory alias and its real path is parsed once", async () => {
    const root = makeTempDir();
    const realDir = join(root, "real");
    mkdirSync(realDir);
    writeFileSync(
      join(realDir, "entry.yaml"),
      ["openapi: 3.0.3", "info: { title: t, version: '1' }", "paths: {}"].join("\n"),
    );
    symlinkSync(realDir, join(root, "alias"), "dir");

    const fs = new NodeFileSystem();
    const graph = await loadWorkspaceGraph(fs, join(root, "alias", "entry.yaml"));

    expect(graph.documents.size).toBe(1);
    // The one document is keyed under the physical identity, shared by both spellings.
    const real = fs.canonicalize(join(realDir, "entry.yaml"));
    const alias = fs.canonicalize(join(root, "alias", "entry.yaml"));
    expect(real).toBe(alias);
    expect(graph.documents.has(real)).toBe(true);
  });

  test("a two-file cycle reached via a symlink alias on one side yields a single cycle diagnostic", async () => {
    const root = makeTempDir();
    const realDir = join(root, "real");
    mkdirSync(realDir);
    symlinkSync(realDir, join(root, "alias"), "dir");
    // b.yaml refers back to a.yaml through the alias, while a.yaml is reached through the real path.
    writeFileSync(join(realDir, "a.yaml"), "x: { $ref: './b.yaml#/y' }");
    writeFileSync(join(realDir, "b.yaml"), `y: { $ref: '${join(root, "alias", "a.yaml")}#/x' }`);

    const fs = new NodeFileSystem();
    const graph = await loadWorkspaceGraph(fs, join(realDir, "a.yaml"));

    expect(graph.documents.size).toBe(2);
    const cycles = allDiagnostics(graph).filter((d) => d.code === "no-ref-cycle");
    expect(cycles).toHaveLength(1);
  });

  test("a self reference through a symlink alias does not duplicate the document", async () => {
    const root = makeTempDir();
    const realDir = join(root, "real");
    mkdirSync(realDir);
    symlinkSync(realDir, join(root, "alias"), "dir");
    writeFileSync(
      join(realDir, "self.yaml"),
      [
        "openapi: 3.0.3",
        "info: { title: t, version: '1' }",
        "components:",
        "  schemas:",
        "    A: { type: object }",
        `    B: { $ref: '${join(root, "alias", "self.yaml")}#/components/schemas/A' }`,
      ].join("\n"),
    );

    const fs = new NodeFileSystem();
    const graph = await loadWorkspaceGraph(fs, join(realDir, "self.yaml"));

    expect(graph.documents.size).toBe(1);
    expect(allDiagnostics(graph).filter((d) => d.code === "no-ref-cycle")).toHaveLength(0);
  });

  test("a missing reference reached through two alias spellings is attempted and diagnosed once", async () => {
    const root = makeTempDir();
    const realDir = join(root, "real");
    mkdirSync(realDir);
    symlinkSync(realDir, join(root, "alias"), "dir");
    writeFileSync(
      join(realDir, "entry.yaml"),
      [
        "openapi: 3.0.3",
        "info: { title: t, version: '1' }",
        "components:",
        "  schemas:",
        "    A: { $ref: './missing.yaml#/x' }",
        `    B: { $ref: '${join(root, "alias", "missing.yaml")}#/y' }`,
      ].join("\n"),
    );

    const fs = new NodeFileSystem();
    const graph = await loadWorkspaceGraph(fs, join(realDir, "entry.yaml"));

    const failures = allDiagnostics(graph).filter((d) => d.code === "no-unresolved-ref");
    expect(failures).toHaveLength(1);
  });

  test("diagnostics report a deliberate canonical display path rather than the alias spelling", async () => {
    const root = makeTempDir();
    const realDir = join(root, "real");
    mkdirSync(realDir);
    symlinkSync(realDir, join(root, "alias"), "dir");
    writeFileSync(join(realDir, "entry.yaml"), "openapi: 3.0.3\n");

    const fs = new NodeFileSystem();
    const graph = await loadWorkspaceGraph(fs, join(root, "alias", "entry.yaml"));

    // The entry path exposed on the graph is the canonical (physical) identity, matching the
    // single document key below — not the alias spelling the caller passed in. This mirrors the
    // existing relative-vs-absolute precedent (issue #25): the displayed path is always the
    // canonicalized one.
    expect(graph.entryPath).toBe(fs.canonicalize(join(realDir, "entry.yaml")));
    expect([...graph.documents.keys()]).toEqual([graph.entryPath]);
  });

  // Only meaningful on case-insensitive filesystems (default macOS/Windows).
  test("case aliases of the same physical file are parsed once on case-insensitive filesystems", async () => {
    const root = makeTempDir();
    writeFileSync(join(root, "Entry.yaml"), "openapi: 3.0.3\n");
    const caseInsensitive = existsSync(join(root, "entry.yaml"));
    if (!caseInsensitive) return;

    const fs = new NodeFileSystem();
    const graph = await loadWorkspaceGraph(fs, join(root, "ENTRY.yaml"));

    expect(graph.documents.size).toBe(1);
    expect(graph.entryPath).toBe(fs.canonicalize(join(root, "Entry.yaml")));
  });
});
