import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { bundle } from "../src/index.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function loadFixture(dir: string, entryFile = "entry.yaml") {
  const fs = new NodeFileSystem();
  return loadWorkspaceGraph(fs, `${fixturesRoot}/${dir}/${entryFile}`);
}

/**
 * Load loading order in `@oasis/core`'s `loadWorkspaceGraph` (packages/core/src/graph.ts) is a
 * strict pre-order depth-first walk from the entry document: each document is loaded, then its
 * `$ref`s are followed in the order they appear in the parsed YAML AST (source order), before
 * moving to the next sibling. No `readdir`/glob or other filesystem enumeration is involved
 * anywhere in the load path, so `graph.documents` insertion order is a pure function of the
 * entry document's content -- never dependent on OS/filesystem iteration order.
 *
 * The bundler (packages/bundler/src/bundle.ts) never iterates `graph.documents` itself: the only
 * access is a single keyed `graph.documents.get(graph.entryPath)` to find the entry document.
 * Every other iteration in bundle.ts walks a specific document's YAML AST `.items` (which mirrors
 * source text order), so there is no Map-iteration-order value that could leak into output.
 * Given these two facts, bundler output order does not depend on JS `Map`/`Set` iteration order
 * at all -- it's fully pinned by (a) source AST order and (b) the `usedNames`/`identityMap`
 * insertion order, which itself is driven by AST walk order. This file exercises that contract
 * rather than re-deriving it.
 */

describe("bundler determinism: repeated bundles are byte-identical", () => {
  test("normal mode, YAML format", async () => {
    const graph1 = await loadFixture("multifile30");
    const graph2 = await loadFixture("multifile30");
    expect(bundle(graph1).output).toBe(bundle(graph2).output);
  });

  test("normal mode, JSON format", async () => {
    const graph1 = await loadFixture("multifile30");
    const graph2 = await loadFixture("multifile30");
    expect(bundle(graph1, { format: "json" }).output).toBe(bundle(graph2, { format: "json" }).output);
  });

  test("normal mode, name-conflict fixture, YAML format", async () => {
    const graph1 = await loadFixture("conflict");
    const graph2 = await loadFixture("conflict");
    expect(bundle(graph1).output).toBe(bundle(graph2).output);
  });

  test("--dereference mode, YAML format", async () => {
    const graph1 = await loadFixture("deref-mixed");
    const graph2 = await loadFixture("deref-mixed");
    expect(bundle(graph1, { dereference: true }).output).toBe(bundle(graph2, { dereference: true }).output);
  });

  test("--dereference mode, JSON format", async () => {
    const graph1 = await loadFixture("deref-simple");
    const graph2 = await loadFixture("deref-simple");
    expect(bundle(graph1, { dereference: true, format: "json" }).output).toBe(
      bundle(graph2, { dereference: true, format: "json" }).output,
    );
  });
});

describe("bundler determinism: key order preservation", () => {
  test("entry document top-level keys keep source order, even when non-alphabetical", async () => {
    // Deliberately non-alphabetical top-level order: info, openapi, paths, components
    // (alphabetical would be components, info, openapi, paths).
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": `
info:
  version: "1.0.0"
  title: Order Test
openapi: 3.0.3
paths:
  /ping:
    get:
      operationId: ping
      tags: [x]
      description: Ping.
      responses:
        '200':
          description: OK
components: {}
`,
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const result = bundle(graph);

    const infoIdx = result.output.indexOf("info:");
    const openapiIdx = result.output.indexOf("openapi:");
    const pathsIdx = result.output.indexOf("paths:");
    const componentsIdx = result.output.indexOf("components:");

    expect(infoIdx).toBeGreaterThanOrEqual(0);
    expect(infoIdx).toBeLessThan(openapiIdx);
    expect(openapiIdx).toBeLessThan(pathsIdx);
    expect(pathsIdx).toBeLessThan(componentsIdx);
  });

  test("lifted external component preserves source property order (non-alphabetical)", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": `
openapi: 3.0.3
info:
  title: Order Test
  version: "1.0.0"
paths:
  /widgets:
    get:
      operationId: listWidgets
      tags: [x]
      description: List widgets.
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: './widget.yaml#/components/schemas/Widget'
`,
      "/virtual/widget.yaml": `
components:
  schemas:
    Widget:
      type: object
      properties:
        zeta:
          type: string
        alpha:
          type: string
        mu:
          type: string
`,
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const result = bundle(graph);

    const zetaIdx = result.output.indexOf("zeta:");
    const alphaIdx = result.output.indexOf("alpha:");
    const muIdx = result.output.indexOf("mu:");

    expect(zetaIdx).toBeGreaterThanOrEqual(0);
    expect(zetaIdx).toBeLessThan(alphaIdx);
    expect(alphaIdx).toBeLessThan(muIdx);
  });

  test("--dereference mode inlines content preserving source property order", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": `
openapi: 3.0.3
info:
  title: Order Test
  version: "1.0.0"
paths:
  /widgets:
    get:
      operationId: listWidgets
      tags: [x]
      description: List widgets.
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: './widget.yaml#/components/schemas/Widget'
`,
      "/virtual/widget.yaml": `
components:
  schemas:
    Widget:
      type: object
      properties:
        zeta:
          type: string
        alpha:
          type: string
        mu:
          type: string
`,
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const result = bundle(graph, { dereference: true });

    expect(result.output).not.toContain("$ref");

    const zetaIdx = result.output.indexOf("zeta:");
    const alphaIdx = result.output.indexOf("alpha:");
    const muIdx = result.output.indexOf("mu:");

    expect(zetaIdx).toBeGreaterThanOrEqual(0);
    expect(zetaIdx).toBeLessThan(alphaIdx);
    expect(alphaIdx).toBeLessThan(muIdx);
  });
});

describe("bundler determinism: generated component names are stable and order-derived", () => {
  test("name-conflict fixture: same User/User_2 assignment across repeated bundles", async () => {
    const graph1 = await loadFixture("conflict");
    const result1 = bundle(graph1).output;
    const graph2 = await loadFixture("conflict");
    const result2 = bundle(graph2).output;

    expect(result1).toBe(result2);
    // a.yaml is referenced first (from /a, declared before /b), so it claims the base name;
    // b.yaml's conflicting User is pushed to the numeric-suffixed name.
    expect(result1).toContain("aOnly");
    expect(result1.indexOf("User:")).toBeLessThan(result1.indexOf("User_2:"));
    const aOnlyIdx = result1.indexOf("aOnly");
    const bOnlyIdx = result1.indexOf("bOnly");
    const userIdx = result1.indexOf("User:");
    const user2Idx = result1.indexOf("User_2:");
    expect(userIdx).toBeLessThan(aOnlyIdx < bOnlyIdx ? bOnlyIdx : aOnlyIdx); // sanity: both entries present
    // Precisely pin which body backs which name: "User" is a.yaml's (has aOnly), "User_2" is b.yaml's (has bOnly).
    const userBody = result1.slice(userIdx, user2Idx);
    const user2Body = result1.slice(user2Idx);
    expect(userBody).toContain("aOnly");
    expect(user2Body).toContain("bOnly");
  });

  test("flipping declaration order of the two conflicting refs flips which one gets the suffix", async () => {
    const makeFs = (firstFile: "a" | "b") =>
      new InMemoryFileSystem({
        "/virtual/entry.yaml": `
openapi: 3.0.3
info:
  title: Conflict Flip
  version: "1.0.0"
paths:
  /first:
    get:
      operationId: getFirst
      tags: [x]
      description: Get first.
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: './${firstFile}.yaml#/components/schemas/User'
  /second:
    get:
      operationId: getSecond
      tags: [x]
      description: Get second.
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: './${firstFile === "a" ? "b" : "a"}.yaml#/components/schemas/User'
`,
        "/virtual/a.yaml": `
components:
  schemas:
    User:
      type: object
      properties:
        aOnly:
          type: string
`,
        "/virtual/b.yaml": `
components:
  schemas:
    User:
      type: object
      properties:
        bOnly:
          type: string
`,
      });

    // a.yaml referenced first: it claims "User", b.yaml's conflicting User becomes "User_2".
    const graphAFirst = await loadWorkspaceGraph(makeFs("a"), "/virtual/entry.yaml");
    const outputAFirst = bundle(graphAFirst).output;
    const userIdxA = outputAFirst.indexOf("User:");
    const user2IdxA = outputAFirst.indexOf("User_2:");
    expect(outputAFirst.slice(userIdxA, user2IdxA)).toContain("aOnly");
    expect(outputAFirst.slice(user2IdxA)).toContain("bOnly");

    // b.yaml referenced first: assignment flips -- b.yaml claims "User", a.yaml becomes "User_2".
    const graphBFirst = await loadWorkspaceGraph(makeFs("b"), "/virtual/entry.yaml");
    const outputBFirst = bundle(graphBFirst).output;
    const userIdxB = outputBFirst.indexOf("User:");
    const user2IdxB = outputBFirst.indexOf("User_2:");
    expect(outputBFirst.slice(userIdxB, user2IdxB)).toContain("bOnly");
    expect(outputBFirst.slice(user2IdxB)).toContain("aOnly");

    // And this flipped assignment is itself deterministic across repeated bundles.
    const graphBFirstAgain = await loadWorkspaceGraph(makeFs("b"), "/virtual/entry.yaml");
    expect(bundle(graphBFirstAgain).output).toBe(outputBFirst);
  });
});
