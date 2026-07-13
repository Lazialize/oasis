import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { bundle } from "../src/index.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function loadFixture(dir: string, entryFile = "entry.yaml") {
  const fs = new NodeFileSystem();
  return loadWorkspaceGraph(fs, `${fixturesRoot}/${dir}/${entryFile}`);
}

// #28: `x-*` extension payloads are opaque; structural-looking keys inside are copied verbatim.
describe("#28 vendor extension payloads are opaque", () => {
  test("keys like mapping/schema/properties/examples/$ref inside x- are not rewritten", async () => {
    const graph = await loadFixture("extension-opaque");
    const result = bundle(graph);

    const doc = parseYaml(result.output) as any;
    const meta = doc.info["x-meta"];

    // Nothing under the extension is interpreted: every value stays the raw string it was authored.
    expect(meta.mapping.dog).toBe("./dog.yaml");
    expect(meta.schema).toEqual({ $ref: "./dog.yaml" });
    expect(meta.properties.foo).toBe("./dog.yaml");
    expect(meta.examples.sample).toEqual({ $ref: "./dog.yaml" });
    expect(meta.$ref).toBe("./dog.yaml");

    // The extension must not have produced a bogus lowercase `dog` component.
    expect(doc.components.schemas.dog).toBeUndefined();
    expect(result.output).not.toContain("#/components/schemas/dog");

    // The genuine ref elsewhere is still lifted normally.
    expect(doc.components.schemas.Dog).toBeDefined();
    // (No self-contained re-check here: the bundle deliberately keeps the ref-shaped strings inside
    // the opaque `x-meta` payload verbatim, so a naive re-resolution would try to follow them.)
  });
});
