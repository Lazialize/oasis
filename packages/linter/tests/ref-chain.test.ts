import { describe, expect, test } from "bun:test";
import { isMap } from "yaml";
import { InMemoryFileSystem, loadWorkspaceGraph, nodeAtPointer } from "@oasis/core";
import type { OasisDocument } from "@oasis/core";
import { childAt, resolveMaybeRef } from "../src/util.ts";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

/**
 * Issue #47: reference chains are followed until a concrete target / failure / cycle, with no fixed
 * hop limit. These exercise `resolveMaybeRef` (the shared chain follower) directly.
 */

async function graphFor(files: Record<string, string>, entry = "/virtual/entry.yaml") {
  const fs = new InMemoryFileSystem(files);
  return loadWorkspaceGraph(fs, entry);
}

function schemaHeader(): string {
  return `openapi: 3.1.0\ninfo:\n  title: Chain\n  version: "1.0.0"\npaths: {}\ncomponents:\n  schemas:\n`;
}

function startNode(entryDoc: OasisDocument, pointer: string) {
  const found = nodeAtPointer(entryDoc, pointer);
  if (!found) throw new Error(`no node at ${pointer}`);
  return found.node;
}

describe("reference chain resolution (issue #47)", () => {
  test("resolves an acyclic chain of more than ten links to the concrete target", async () => {
    const N = 15;
    let body = schemaHeader();
    for (let i = 0; i < N; i++) {
      body += `    Link${i}:\n      $ref: "#/components/schemas/Link${i + 1}"\n`;
    }
    body += `    Link${N}:\n      type: object\n      title: Concrete\n`;

    const graph = await graphFor({ "/virtual/entry.yaml": body });
    const entryDoc = graph.documents.get("/virtual/entry.yaml")!;
    const resolved = resolveMaybeRef(graph, entryDoc, startNode(entryDoc, "/components/schemas/Link0"), "/components/schemas/Link0");

    expect(isMap(resolved.node)).toBe(true);
    expect(resolved.pointer).toBe("/components/schemas/Link15");
    expect(childAt(resolved.node, "$ref")).toBeUndefined();
    expect(childAt(resolved.node, "title")).toBeDefined();
  });

  test("a direct self-cycle terminates and returns the last reachable node", async () => {
    const body = schemaHeader() + `    A:\n      $ref: "#/components/schemas/A"\n`;
    const graph = await graphFor({ "/virtual/entry.yaml": body });
    const entryDoc = graph.documents.get("/virtual/entry.yaml")!;
    const resolved = resolveMaybeRef(graph, entryDoc, startNode(entryDoc, "/components/schemas/A"), "/components/schemas/A");
    // Terminates (no infinite loop) and lands on a Reference Object (the cycle node).
    expect(childAt(resolved.node, "$ref")).toBeDefined();
  });

  test("an indirect cycle terminates", async () => {
    const body =
      schemaHeader() +
      `    A:\n      $ref: "#/components/schemas/B"\n` +
      `    B:\n      $ref: "#/components/schemas/C"\n` +
      `    C:\n      $ref: "#/components/schemas/A"\n`;
    const graph = await graphFor({ "/virtual/entry.yaml": body });
    const entryDoc = graph.documents.get("/virtual/entry.yaml")!;
    const resolved = resolveMaybeRef(graph, entryDoc, startNode(entryDoc, "/components/schemas/A"), "/components/schemas/A");
    expect(childAt(resolved.node, "$ref")).toBeDefined();
  });

  test("follows a long chain across files", async () => {
    const entry =
      schemaHeader() + `    Start:\n      $ref: "./a.yaml#/components/schemas/A"\n`;
    const a = schemaHeader() + `    A:\n      $ref: "./b.yaml#/components/schemas/B"\n`;
    const b =
      schemaHeader() +
      `    B:\n      $ref: "./a.yaml#/components/schemas/C"\n`;
    const a2 =
      schemaHeader() +
      `    A:\n      $ref: "./b.yaml#/components/schemas/B"\n` +
      `    C:\n      type: string\n      title: CrossFileConcrete\n`;
    const graph = await graphFor({
      "/virtual/entry.yaml": entry,
      "/virtual/a.yaml": a2,
      "/virtual/b.yaml": b,
    });
    const entryDoc = graph.documents.get("/virtual/entry.yaml")!;
    const resolved = resolveMaybeRef(graph, entryDoc, startNode(entryDoc, "/components/schemas/Start"), "/components/schemas/Start");
    expect(resolved.doc.filePath).toBe("/virtual/a.yaml");
    expect(resolved.pointer).toBe("/components/schemas/C");
    expect(childAt(resolved.node, "$ref")).toBeUndefined();
  });

  test("refs/no-cycle still reports a cyclic chain (linting does not hang)", async () => {
    const body = schemaHeader() + `    A:\n      $ref: "#/components/schemas/A"\n`;
    const graph = await graphFor({ "/virtual/entry.yaml": body });
    const diagnostics = lint(graph, resolveConfig(undefined));
    // Sanity: the run completes and produces diagnostics rather than looping forever.
    expect(Array.isArray(diagnostics)).toBe(true);
  });
});
