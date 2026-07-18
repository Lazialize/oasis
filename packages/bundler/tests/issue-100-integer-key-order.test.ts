import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { bundle } from "../src/index.ts";

// #100: bundling converts YAML maps to plain JS objects. JS enumerates integer-index property
// names in ascending numeric order, so authored source order is lost for status codes, numeric
// component names, and any other integer-like mapping key. The bundler's documented contract is to
// preserve source AST key order where practical; integer-like keys must retain their authored order
// just like ordinary keys, in both YAML and JSON output and across repeated runs.
//
// Assertions run against the raw serialized *string* rather than a re-parsed object: JS re-sorts
// integer-index keys the moment YAML/JSON is parsed back into an object, so `Object.keys` of a
// parsed doc can never observe the preserved order — only the emitted text can.

const ENTRY = `
openapi: 3.0.3
info:
  title: Integer Key Order
  version: "1.0.0"
paths:
  /widgets:
    get:
      operationId: listWidgets
      tags: [x]
      description: List widgets.
      responses:
        '404': { description: not found }
        '200': { description: ok }
        '2XX': { description: success range }
        '500': { description: server error }
components:
  schemas:
    "10": { type: string }
    "2": { type: integer }
    Widget: { type: object }
    "1": { type: boolean }
`;

function makeGraph() {
  const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": ENTRY });
  return loadWorkspaceGraph(fs, "/virtual/entry.yaml");
}

/** Assert `keys` appear in the given order in `output`, each present (index >= 0) and strictly increasing. */
function expectOrder(output: string, keys: string[]): void {
  const indexes = keys.map((k) => output.indexOf(k));
  for (let i = 0; i < indexes.length; i++) {
    expect(indexes[i]).toBeGreaterThanOrEqual(0);
    if (i > 0) expect(indexes[i - 1]).toBeLessThan(indexes[i] as number);
  }
}

describe("#100 integer-like mapping keys keep source order", () => {
  // Both YAML and JSON emit integer-like keys quoted; ordinary names stay quoted in JSON and
  // unquoted in YAML.
  // "404"/"200"/"500" are integer-like, so both YAML and JSON quote them; "2XX" is a plain string,
  // quoted only in JSON.
  const responseKeys = (format: "yaml" | "json") => [`"404":`, `"200":`, format === "json" ? `"2XX":` : "2XX:", `"500":`];

  for (const format of ["yaml", "json"] as const) {
    test(`Responses Object keeps authored status-code order (${format})`, async () => {
      const result = bundle(await makeGraph(), { format });
      expectOrder(result.output, responseKeys(format));
    });

    test(`component schema map keeps authored integer/mixed order (${format})`, async () => {
      const result = bundle(await makeGraph(), { format });
      const widget = format === "json" ? `"Widget":` : "Widget:";
      expectOrder(result.output, [`"10":`, `"2":`, widget, `"1":`]);
    });
  }

  test("repeated bundles are byte-identical in both formats", async () => {
    expect(bundle(await makeGraph()).output).toBe(bundle(await makeGraph()).output);
    expect(bundle(await makeGraph(), { format: "json" }).output).toBe(
      bundle(await makeGraph(), { format: "json" }).output,
    );
  });

  test("--dereference mode preserves integer-like key order and stays deterministic", async () => {
    const out1 = bundle(await makeGraph(), { dereference: true }).output;
    const out2 = bundle(await makeGraph(), { dereference: true }).output;
    expect(out1).toBe(out2);
    expectOrder(out1, responseKeys("yaml"));
    // Unreferenced entry components are kept verbatim under source order.
    expectOrder(out1, [`"10":`, `"2":`, "Widget:", `"1":`]);
  });

  test("lifted external component map keeps integer-like key order", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": `
openapi: 3.0.3
info:
  title: Lifted Order
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
                $ref: './lib.yaml#/components/schemas/Envelope'
`,
      "/virtual/lib.yaml": `
components:
  schemas:
    Envelope:
      type: object
      properties:
        "10": { type: string }
        "2": { type: integer }
        name: { type: string }
        "1": { type: boolean }
`,
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    for (const format of ["yaml", "json"] as const) {
      const output = bundle(graph, { format }).output;
      const name = format === "json" ? `"name":` : "name:";
      expectOrder(output, [`"10":`, `"2":`, name, `"1":`]);
    }
  });
});
