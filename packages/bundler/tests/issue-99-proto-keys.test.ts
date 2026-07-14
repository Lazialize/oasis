import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { NodeFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { bundle } from "../src/index.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function loadFixture(dir: string, entryFile = "entry.yaml") {
  const fs = new NodeFileSystem();
  return loadWorkspaceGraph(fs, `${fixturesRoot}/${dir}/${entryFile}`);
}

/** Own-property check that doesn't get fooled by a "__proto__" that only mutated the prototype. */
function hasOwn(obj: unknown, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// #99: a document key literally named "__proto__" must be preserved as ordinary data — not consumed
// by the legacy `Object.prototype.__proto__` accessor, which would silently drop the entry and (for
// plain-object targets) mutate the prototype of the containing map instead of adding a data property.
describe("#99 __proto__ keys are preserved, not swallowed by the prototype setter", () => {
  for (const dereference of [false, true]) {
    for (const format of ["yaml", "json"] as const) {
      test(`component map, schema properties, literal payload, and extension (dereference=${dereference}, format=${format})`, async () => {
        const graph = await loadFixture("proto-keys");
        const result = bundle(graph, { dereference, format });
        expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

        const doc = format === "json" ? JSON.parse(result.output) : (parseYaml(result.output) as any);

        // The output object itself must not have had its prototype mutated by building it.
        expect(Object.getPrototypeOf(doc)).toBe(Object.prototype);

        // components/schemas/__proto__ is never referenced by any `$ref`, so it survives as an own
        // data property in `components/schemas` in both modes.
        expect(hasOwn(doc.components.schemas, "__proto__")).toBe(true);
        expect(doc.components.schemas.__proto__).toEqual({ type: "string" });

        // `Holder` IS referenced (by the response schema below): in `--dereference` mode it's
        // inlined at the ref site and dropped from `components` entirely; in normal mode it stays
        // as a named component and the ref site holds a `$ref` to it.
        const responseSchema = doc.paths["/widget"].get.responses["200"].content["application/json"].schema;
        let holder: any;
        if (dereference) {
          expect(hasOwn(doc.components.schemas, "Holder")).toBe(false);
          holder = responseSchema;
        } else {
          expect(hasOwn(doc.components.schemas, "Holder")).toBe(true);
          expect(responseSchema).toEqual({ $ref: "#/components/schemas/Holder" });
          holder = doc.components.schemas.Holder;
        }

        // Holder.properties.__proto__ survives alongside `ok`.
        expect(hasOwn(holder.properties, "__proto__")).toBe(true);
        expect(holder.properties.__proto__).toEqual({ type: "integer" });
        expect(hasOwn(holder.properties, "ok")).toBe(true);

        // Literal example payload: __proto__ under an "examples"/"value" literal subtree.
        const example = doc.paths["/widget"].get.responses["200"].content["application/json"].examples.sample.value;
        expect(hasOwn(example, "__proto__")).toBe(true);
        expect(example.__proto__).toBe("literal-example");
        expect(hasOwn(example, "ok")).toBe(true);

        // Specification extension payload: __proto__ under an "x-*" opaque subtree.
        expect(hasOwn(doc.info["x-meta"], "__proto__")).toBe(true);
        expect(doc.info["x-meta"].__proto__).toBe("injected");
        expect(hasOwn(doc.info["x-meta"], "ok")).toBe(true);

        // Nothing leaked into Object.prototype: a fresh plain object must not suddenly gain these.
        expect(({} as any).ok).toBeUndefined();
        expect(typeof ({} as any).type).toBe("undefined");
      });
    }
  }

  for (const dereference of [false, true]) {
    test(`external component named "__proto__" is lifted as an own property (dereference=${dereference})`, async () => {
      const graph = await loadFixture("proto-keys-external");
      const result = bundle(graph, { dereference });
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

      const doc = parseYaml(result.output) as any;
      expect(Object.getPrototypeOf(doc)).toBe(Object.prototype);

      const schemaRef = doc.paths["/widget"].get.responses["200"].content["application/json"].schema;
      if (dereference) {
        // Fully inlined: no `components` section is needed since the only component was reachable.
        expect(schemaRef).toEqual({ type: "string" });
      } else {
        // Lifted into components/schemas under its own (proto-unsafe) name, as an own property.
        expect(hasOwn(doc.components.schemas, "__proto__")).toBe(true);
        expect(doc.components.schemas.__proto__).toEqual({ type: "string" });
        expect(schemaRef.$ref).toBe("#/components/schemas/__proto__");
      }
    });
  }
});
