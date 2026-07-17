import { expect, test } from "bun:test";
import { InMemoryFileSystem } from "../src/filesystem.ts";
import { graphReferences, loadWorkspaceGraph } from "../src/graph.ts";
import { nodeAtPointer } from "../src/document.ts";
import { resolveRef } from "../src/ref.ts";

test("3.1 schema $dynamicRef discovery loads static targets and follows schema $ref targets", async () => {
  const entry = "/virtual/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "x-external-uri: &externalUri './external.yaml#/Target'",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Root:",
      "      $dynamicAnchor: node",
      "      type: object",
      "      properties:",
      "        local: { $dynamicRef: '#node' }",
      "        external: { $dynamicRef: *externalUri }",
      "    ViaRef: { $ref: './resource.yaml#/Root' }",
    ].join("\n"),
    "/virtual/external.yaml": "Target: { type: string }\n",
    "/virtual/resource.yaml": [
      "Root:",
      "  type: object",
      "  properties:",
      "    next: { $dynamicRef: './nested.yaml#/Target' }",
    ].join("\n"),
    "/virtual/nested.yaml": "Target: { type: integer }\n",
  }), entry);

  expect([...graph.documents.keys()].sort()).toEqual([
    entry,
    "/virtual/external.yaml",
    "/virtual/nested.yaml",
    "/virtual/resource.yaml",
  ]);

  const entryDoc = graph.documents.get(entry)!;
  const dynamicRefs = graphReferences(graph, entryDoc).filter((ref) => ref.kind === "dynamic-ref");
  expect(dynamicRefs.map((ref) => ref.value).sort()).toEqual(["#node", "./external.yaml#/Target"]);
  expect(dynamicRefs.every((ref) => ref.targetKind === "schema")).toBe(true);

  const local = dynamicRefs.find((ref) => ref.value === "#node")!;
  const localTarget = resolveRef(graph, entryDoc, local.value, local.range);
  expect(localTarget.ok).toBe(true);
  if (localTarget.ok) {
    expect(localTarget.doc.filePath).toBe(entry);
    expect(localTarget.node.range).toEqual(nodeAtPointer(entryDoc, "/components/schemas/Root")?.node.range);
    expect(localTarget.range.filePath).toBe(entry);
  }

  const external = dynamicRefs.find((ref) => ref.value === "./external.yaml#/Target")!;
  const externalTarget = resolveRef(graph, entryDoc, external.value, external.range);
  expect(externalTarget.ok).toBe(true);
  if (externalTarget.ok) {
    const externalDoc = graph.documents.get("/virtual/external.yaml")!;
    expect(externalTarget.doc).toBe(externalDoc);
    expect(externalTarget.node.range).toEqual(nodeAtPointer(externalDoc, "/Target")?.node.range);
    expect(externalTarget.range.filePath).toBe("/virtual/external.yaml");
  }

  const resourceDoc = graph.documents.get("/virtual/resource.yaml")!;
  expect(graphReferences(graph, resourceDoc).filter((ref) => ref.kind === "dynamic-ref").map((ref) => ref.value)).toEqual([
    "./nested.yaml#/Target",
  ]);
});

test("an aliased components.schemas container retains 3.1 schema semantics", async () => {
  const entry = "/virtual/alias.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "x-schema-map: &schemaMap",
      "  Aliased: { $dynamicRef: './aliased.yaml#/Target' }",
      "components:",
      "  schemas: *schemaMap",
    ].join("\n"),
    "/virtual/aliased.yaml": "Target: { type: boolean }\n",
  }), entry);

  expect([...graph.documents.keys()].sort()).toEqual([entry, "/virtual/aliased.yaml"]);
  const dynamic = graphReferences(graph, graph.documents.get(entry)!).find((ref) => ref.kind === "dynamic-ref");
  expect(dynamic?.value).toBe("./aliased.yaml#/Target");
  expect(dynamic?.range.filePath).toBe(entry);
  expect(dynamic?.range.start.line).toBe(4);
});

test("inline Parameter, Header, and Media Type schemas retain 3.1 schema semantics", async () => {
  const entry = "/virtual/inline.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths:",
      "  /items:",
      "    get:",
      "      parameters:",
      "        - name: q",
      "          in: query",
      "          schema: { $dynamicRef: './parameter.yaml#/Target' }",
      "      requestBody:",
      "        content:",
      "          application/json:",
      "            schema: { $dynamicRef: '#node' }",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema: { $dynamicRef: './response.yaml#/Target' }",
      "components:",
      "  headers:",
      "    Trace:",
      "      schema: { $dynamicRef: './header.yaml#/Target' }",
      "  schemas:",
      "    Root: { $dynamicAnchor: node, type: object }",
    ].join("\n"),
    "/virtual/parameter.yaml": "Target: { type: string }\n",
    "/virtual/response.yaml": "Target: { type: object }\n",
    "/virtual/header.yaml": "Target: { type: integer }\n",
  }), entry);

  expect([...graph.documents.keys()].sort()).toEqual([
    "/virtual/header.yaml",
    entry,
    "/virtual/parameter.yaml",
    "/virtual/response.yaml",
  ]);
  expect(
    graphReferences(graph, graph.documents.get(entry)!)
      .filter((ref) => ref.kind === "dynamic-ref")
      .map((ref) => ref.value)
      .sort(),
  ).toEqual(["#node", "./header.yaml#/Target", "./parameter.yaml#/Target", "./response.yaml#/Target"]);
});

test("Encoding Object headers propagate schema semantics without interpreting extension lookalikes", async () => {
  const entry = "/virtual/encoding.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths:",
      "  /items:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema: { type: object, properties: { payload: { type: string } } }",
      "              encoding:",
      "                payload:",
      "                  headers:",
      "                    X-Inline:",
      "                      schema: { $dynamicRef: './inline.yaml#/Target' }",
      "                    X-External: { $ref: './header.yaml#/H' }",
      "                  x-lookalike:",
      "                    headers:",
      "                      X-Fake:",
      "                        schema: { $dynamicRef: './fake-encoding-extension.yaml#/Fake' }",
      "              x-lookalike:",
      "                encoding:",
      "                  payload:",
      "                    headers:",
      "                      X-Fake:",
      "                        schema: { $dynamicRef: './fake-media-extension.yaml#/Fake' }",
    ].join("\n"),
    "/virtual/header.yaml": [
      "H:",
      "  schema: { $dynamicRef: './external.yaml#/Target' }",
    ].join("\n"),
    "/virtual/inline.yaml": "Target: { type: string }\n",
    "/virtual/external.yaml": "Target: { type: integer }\n",
    "/virtual/fake-encoding-extension.yaml": "Fake: { type: boolean }\n",
    "/virtual/fake-media-extension.yaml": "Fake: { type: boolean }\n",
  }), entry);

  expect([...graph.documents.keys()].sort()).toEqual([
    entry,
    "/virtual/external.yaml",
    "/virtual/header.yaml",
    "/virtual/inline.yaml",
  ].sort());
  expect(
    [...graph.documents.values()].flatMap((doc) => graphReferences(graph, doc))
      .filter((ref) => ref.kind === "dynamic-ref")
      .map((ref) => ref.value)
      .sort(),
  ).toEqual(["./external.yaml#/Target", "./inline.yaml#/Target"]);
  const headerRef = graphReferences(graph, graph.documents.get(entry)!)
    .find((ref) => ref.value === "./header.yaml#/H");
  expect(headerRef?.targetKind).toBe("header");
});

test("a referenced external Parameter Object propagates schema semantics to its target", async () => {
  const entry = "/virtual/referenced-parameter.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "components:",
      "  parameters:",
      "    External: { $ref: './parameter-object.yaml#/Param' }",
    ].join("\n"),
    "/virtual/parameter-object.yaml": [
      "Param:",
      "  name: q",
      "  in: query",
      "  schema: { $dynamicRef: './value.yaml#/Target' }",
    ].join("\n"),
    "/virtual/value.yaml": "Target: { type: string }\n",
  }), entry);

  expect([...graph.documents.keys()].sort()).toEqual([
    "/virtual/parameter-object.yaml",
    entry,
    "/virtual/value.yaml",
  ]);
  const parameterDoc = graph.documents.get("/virtual/parameter-object.yaml")!;
  expect(graphReferences(graph, parameterDoc).find((ref) => ref.kind === "dynamic-ref")?.value).toBe(
    "./value.yaml#/Target",
  );
});

test("webhook, callback, and component Path Item operations propagate schema semantics", async () => {
  const entry = "/virtual/path-items.yaml";
  const responseWithSchema = (ref: string) => [
    "responses:",
    "  '200':",
    "    description: ok",
    "    content:",
    "      application/json:",
    `        schema: { $dynamicRef: '${ref}' }`,
  ];
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths:",
      "  /start:",
      "    post:",
      "      callbacks:",
      "        done:",
      "          '{$request.body#/url}':",
      "            post:",
      ...responseWithSchema("./callback.yaml#/Target").map((line) => `              ${line}`),
      "webhooks:",
      "  x-hook:",
      "    post:",
      ...responseWithSchema("./webhook.yaml#/Target").map((line) => `      ${line}`),
      "components:",
      "  pathItems:",
      "    Shared:",
      "      get:",
      "        parameters:",
      "          - name: q",
      "            in: query",
      "            schema: { $dynamicRef: './path-item.yaml#/Target' }",
    ].join("\n"),
    "/virtual/callback.yaml": "Target: { type: string }\n",
    "/virtual/webhook.yaml": "Target: { type: string }\n",
    "/virtual/path-item.yaml": "Target: { type: string }\n",
  }), entry);

  expect(
    graphReferences(graph, graph.documents.get(entry)!)
      .filter((ref) => ref.kind === "dynamic-ref")
      .map((ref) => ref.value)
      .sort(),
  ).toEqual(["./callback.yaml#/Target", "./path-item.yaml#/Target", "./webhook.yaml#/Target"]);
});

test("$dynamicRef is ignored outside 3.1 Schema Object semantics", async () => {
  const entry31 = "/virtual/negative-31.yaml";
  const graph31 = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry31]: [
      "openapi: 3.1.0",
      "info:",
      "  title: t",
      "  version: '1'",
      "  schema: { $dynamicRef: './info-schema.yaml#/Fake' }",
      "  schemas:",
      "    Fake: { $dynamicRef: './info-schemas.yaml#/Fake' }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Real:",
      "      type: string",
      "      example: { $dynamicRef: './example.yaml#/Fake' }",
      "      x-payload: { $dynamicRef: './extension.yaml#/Fake' }",
      "  examples:",
      "    Payload:",
      "      value: { $dynamicRef: './value.yaml#/Fake' }",
    ].join("\n"),
  }), entry31);
  expect([...graph31.documents.keys()]).toEqual([entry31]);
  expect(graphReferences(graph31, graph31.documents.get(entry31)!).filter((ref) => ref.kind === "dynamic-ref")).toEqual([]);

  const entry30 = "/virtual/negative-30.yaml";
  const graph30 = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry30]: [
      "openapi: 3.0.3",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Legacy: { $dynamicRef: './legacy.yaml#/Fake' }",
    ].join("\n"),
  }), entry30);
  expect([...graph30.documents.keys()]).toEqual([entry30]);
  expect(graphReferences(graph30, graph30.documents.get(entry30)!).filter((ref) => ref.kind === "dynamic-ref")).toEqual([]);
});

test("Paths extensions are opaque while x-* webhook names remain genuine Path Items", async () => {
  const entry = "/virtual/path-extension.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths:",
      "  x-routing:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: opaque",
      "          content:",
      "            application/json:",
      "              schema: { $dynamicRef: './bad.yaml#/Target' }",
      "webhooks:",
      "  x-routing:",
      "    post:",
      "      responses:",
      "        '200':",
      "          description: genuine",
      "          content:",
      "            application/json:",
      "              schema: { $dynamicRef: './good.yaml#/Target' }",
    ].join("\n"),
    "/virtual/good.yaml": "Target: { type: string }\n",
  }), entry);

  expect([...graph.documents.keys()].sort()).toEqual(["/virtual/good.yaml", entry]);
  expect(
    graphReferences(graph, graph.documents.get(entry)!)
      .filter((ref) => ref.kind === "dynamic-ref")
      .map((ref) => ref.value),
  ).toEqual(["./good.yaml#/Target"]);
  expect(graph.diagnostics).toEqual([]);
});
