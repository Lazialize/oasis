import { describe, expect, test } from "bun:test";
import { isMap } from "yaml";
import { parseDocument } from "../src/parse.ts";
import { findRefs } from "../src/ref.ts";
import { nodeAtPointer } from "../src/document.ts";

const path = "/virtual/anchors.yaml";

describe("YAML anchor/alias handling in core walkers", () => {
  test("findRefs discovers a $ref reachable only through an alias", () => {
    const text = [
      "components:",
      "  schemas:",
      "    Base: &base",
      "      properties:",
      "        pet:",
      "          $ref: './pet.yaml#/Pet'",
      "    Derived: *base",
    ].join("\n");
    const doc = parseDocument(text, path);

    const refs = findRefs(doc).map((r) => r.value);
    expect(refs).toContain("./pet.yaml#/Pet");
    // The physical node is walked once, so the ref is reported exactly once.
    expect(refs.filter((v) => v === "./pet.yaml#/Pet").length).toBe(1);
  });

  test("nodeAtPointer traverses through an alias to the anchored target", () => {
    const text = [
      "components:",
      "  schemas:",
      "    Base: &base",
      "      type: object",
      "    Derived: *base",
    ].join("\n");
    const doc = parseDocument(text, path);

    const viaAlias = nodeAtPointer(doc, "/components/schemas/Derived/type");
    expect(viaAlias).toBeDefined();
    // Range points at the anchored definition, not lost.
    const direct = nodeAtPointer(doc, "/components/schemas/Base/type");
    expect(viaAlias?.range).toEqual(direct?.range);

    const derived = nodeAtPointer(doc, "/components/schemas/Derived");
    expect(derived).toBeDefined();
    expect(isMap(derived!.node)).toBe(true);
  });

  test("detectDuplicateKeys sees duplicates inside an aliased map", () => {
    const text = [
      "a: &dup",
      "  x: 1",
      "  x: 2",
      "b: *dup",
    ].join("\n");
    const doc = parseDocument(text, path);
    const dupes = doc.diagnostics.filter((d) => d.code === "no-duplicate-keys");
    expect(dupes.length).toBe(1);
    expect(dupes[0]?.message).toContain('Duplicate key "x"');
  });

  test("cyclic/self-referential alias does not hang the walkers", () => {
    // A merge-key self reference produces an Alias whose target contains the alias again.
    const text = ["root: &r", "  <<: *r", "  keep: 1"].join("\n");
    const doc = parseDocument(text, path);
    // Should terminate and produce a document; no assertion on refs needed beyond not hanging.
    expect(findRefs(doc)).toBeDefined();
    expect(doc.yamlDoc).toBeDefined();
  });
});
