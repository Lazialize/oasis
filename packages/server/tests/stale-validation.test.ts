import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import type { FileSystem } from "@oasis/core";
import type { Diagnostic as LspDiagnostic } from "vscode-languageserver";
import { createValidationRunner } from "../src/validation.ts";
import { createServerContext, getGraph, invalidateGraph } from "../src/workspace.ts";

/**
 * Issue #49: an async validation started before an edit must never finish *after* the edit's own
 * validation and overwrite the newer diagnostics with stale ones. A gated FileSystem makes the
 * completion order deterministic: the first validation's file reads capture the old content, then
 * block until the test releases them — after the newer validation has already published.
 */

const ENTRY = "/w/entry.yaml";

const BAD_TEXT = `openapi: 3.1.0
info:
  title: Test
  version: "1.0.0"
paths:
  /pets:
    get:
      tags: [pets]
      description: List pets.
      responses:
        '200':
          description: OK
`; // missing operationId -> operation/operation-id (error)

const GOOD_TEXT = BAD_TEXT.replace("      tags:", "      operationId: listPets\n      tags:");

/** Reads content immediately (so an in-flight read captures the *old* text) but holds the result
 * until the per-path gate is released, making async completion order fully deterministic. */
class GatedFileSystem implements FileSystem {
  private gates = new Map<string, Promise<void>>();

  constructor(private readonly inner: InMemoryFileSystem) {}

  /** Block reads of `path` (after they've captured current content) until the returned release. */
  gate(path: string): () => void {
    let release!: () => void;
    this.gates.set(path, new Promise<void>((resolve) => (release = resolve)));
    return () => {
      this.gates.delete(path);
      release();
    };
  }

  ungate(path: string): void {
    this.gates.delete(path);
  }

  async readFile(path: string): Promise<string> {
    const text = this.inner.readFile(path); // capture content NOW, before waiting
    const gate = this.gates.get(path);
    if (gate) await gate;
    return text;
  }

  resolve(fromPath: string, ref: string): string {
    return this.inner.resolve(fromPath, ref);
  }
}

function setup() {
  const inner = new InMemoryFileSystem({ [ENTRY]: BAD_TEXT });
  const fs = new GatedFileSystem(inner);
  const ctx = createServerContext(fs);
  const published = new Map<string, LspDiagnostic[]>();
  const runner = createValidationRunner(ctx, { publish: (f, d) => published.set(f, d) });
  return { inner, fs, ctx, published, runner };
}

function codes(diagnostics: LspDiagnostic[] | undefined): string[] {
  return (diagnostics ?? []).map((d) => String(d.code));
}

describe("createValidationRunner (issue #49: stale async validations)", () => {
  test("an older validation finishing last does not overwrite newer diagnostics", async () => {
    const { inner, fs, ctx, published, runner } = setup();

    // Validation N: starts against BAD_TEXT, then stalls in the (slow) file read.
    const release = fs.gate(ENTRY);
    const staleRun = runner.validate(ENTRY);

    // Edit: content becomes good, graph invalidated, validation N+1 starts and completes first.
    inner.writeFile(ENTRY, GOOD_TEXT);
    invalidateGraph(ctx, ENTRY);
    fs.ungate(ENTRY);
    await runner.validate(ENTRY);
    expect(codes(published.get(ENTRY))).not.toContain("operation/operation-id");

    // Validation N finishes last, with results computed from the old content: discard, not publish.
    release();
    await staleRun;
    expect(codes(published.get(ENTRY))).not.toContain("operation/operation-id");
  });

  test("a stale in-flight graph load does not poison the graph cache", async () => {
    const { inner, fs, ctx, published, runner } = setup();

    const release = fs.gate(ENTRY);
    const staleRun = runner.validate(ENTRY);

    inner.writeFile(ENTRY, GOOD_TEXT);
    invalidateGraph(ctx, ENTRY);
    fs.ungate(ENTRY);
    await runner.validate(ENTRY);

    release();
    await staleRun; // completes AFTER the invalidation: must not (re)cache its stale graph

    // A later consumer of the cache must see the good content, not the stale run's leftover graph.
    const graph = await getGraph(ctx, ENTRY);
    expect(graph.documents.get(ENTRY)?.text ?? "").toContain("operationId: listPets");
    published.clear();
    await runner.validate(ENTRY);
    expect(codes(published.get(ENTRY))).not.toContain("operation/operation-id");
  });

  test("invalidateEntry discards an outstanding validation without touching published state", async () => {
    const { fs, published, runner } = setup();

    const release = fs.gate(ENTRY);
    const staleRun = runner.validate(ENTRY);

    runner.invalidateEntry(ENTRY); // e.g. the document was closed / its project reloaded
    release();
    await staleRun;
    expect(published.has(ENTRY)).toBe(false); // nothing was ever published for it
  });

  test("clearEntry supersedes an outstanding validation so it cannot resurrect cleared diagnostics", async () => {
    const { fs, published, runner } = setup();

    // First, a completed validation publishes the BAD diagnostics.
    await runner.validate(ENTRY);
    expect(codes(published.get(ENTRY))).toContain("operation/operation-id");

    // A re-validation stalls; the entry is then cleared (e.g. dropped from its project).
    const release = fs.gate(ENTRY);
    const staleRun = runner.validate(ENTRY);
    runner.clearEntry(ENTRY);
    expect(published.get(ENTRY)).toEqual([]);

    release();
    await staleRun;
    expect(published.get(ENTRY)).toEqual([]);
  });
});
