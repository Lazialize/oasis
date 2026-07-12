import { describe, expect, test } from "bun:test";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function lintFixture(relativePath: string) {
  const fs = new NodeFileSystem();
  const entry = `${fixturesRoot}/${relativePath}`;
  const graph = await loadWorkspaceGraph(fs, entry);
  const config = resolveConfig(undefined);
  return lint(graph, config);
}

describe("structure/required-fields", () => {
  test("flags a missing paths field", async () => {
    const diagnostics = await lintFixture("structure/missing-paths.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/required-fields");
    expect(d).toBeDefined();
    expect(d?.message).toContain("paths");
    expect(d?.range.start.line).toBe(0);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/required-fields")).toBe(false);
  });
});

describe("structure/openapi-version", () => {
  test("flags a non 3.0/3.1 version string", async () => {
    const diagnostics = await lintFixture("structure/bad-version.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/openapi-version");
    expect(d).toBeDefined();
    expect(d?.range.start.line).toBe(0);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/openapi-version")).toBe(false);
  });
});

describe("structure/field-types", () => {
  test("flags a top-level field with the wrong type", async () => {
    const diagnostics = await lintFixture("structure/bad-field-types.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/field-types");
    expect(d).toBeDefined();
    expect(d?.message).toContain("tags");
    expect(d?.range.start.line).toBe(4);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/field-types")).toBe(false);
  });
});

describe("structure/http-methods", () => {
  test("flags an invalid key under a path item", async () => {
    const diagnostics = await lintFixture("structure/bad-method.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/http-methods");
    expect(d).toBeDefined();
    expect(d?.message).toContain("fetch");
    expect(d?.range.start.line).toBe(6);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/http-methods")).toBe(false);
  });
});

describe("structure/schema-nullable", () => {
  test("flags a type array in OpenAPI 3.0", async () => {
    const diagnostics = await lintFixture("structure/schema-nullable-30.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-nullable");
    expect(d).toBeDefined();
    expect(d?.range.start.line).toBe(20);
  });

  test("flags nullable in OpenAPI 3.1", async () => {
    const diagnostics = await lintFixture("structure/schema-nullable-31.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-nullable");
    expect(d).toBeDefined();
    expect(d?.range.start.line).toBe(21);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/schema-nullable")).toBe(false);
  });
});

describe("structure/security-schemes", () => {
  test("flags a missing type", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"NoType"') && d.message.includes("missing required field \"type\""),
    );
    expect(d).toBeDefined();
  });

  test("flags an unrecognized type", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/security-schemes" && d.message.includes('"BadType"'));
    expect(d?.message).toContain("madeUpType");
  });

  test("flags apiKey missing name", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"BadApiKey"') && d.message.includes('"name"'),
    );
    expect(d).toBeDefined();
  });

  test("flags http missing scheme", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"BadHttp"') && d.message.includes('"scheme"'),
    );
    expect(d).toBeDefined();
  });

  test("flags oauth2 with no flows defined", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"BadOAuth2NoFlows"') && d.message.includes('"flows"'),
    );
    expect(d).toBeDefined();
  });

  test("flags an oauth2 implicit flow missing authorizationUrl", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"BadOAuth2Flow"') && d.message.includes("authorizationUrl"),
    );
    expect(d).toBeDefined();
  });

  test("flags openIdConnect missing openIdConnectUrl", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"BadOpenIdConnect"') && d.message.includes("openIdConnectUrl"),
    );
    expect(d).toBeDefined();
  });

  test("accepts mutualTLS in OpenAPI 3.1", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-mutualtls-31.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/security-schemes")).toBe(false);
  });

  test("rejects mutualTLS in OpenAPI 3.0", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-mutualtls-30.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/security-schemes");
    expect(d?.message).toContain("mutualTLS");
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/security-schemes")).toBe(false);
  });
});

describe("structure/server-variables", () => {
  test("flags a url variable with no matching declaration", async () => {
    const diagnostics = await lintFixture("structure/server-variables-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/server-variables" && d.message.includes("missingVar"),
    );
    expect(d).toBeDefined();
  });

  test("flags a default not listed in enum", async () => {
    const diagnostics = await lintFixture("structure/server-variables-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/server-variables" && d.message.includes('"basePath"') && d.message.includes("enum"),
    );
    expect(d).toBeDefined();
  });

  test("warns about a declared variable unused by the url", async () => {
    const diagnostics = await lintFixture("structure/server-variables-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/server-variables" && d.message.includes('"unused"') && d.message.includes("not referenced"),
    );
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warning");
  });

  test("flags a variable missing a default", async () => {
    const diagnostics = await lintFixture("structure/server-variables-missing-default.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/server-variables" && d.message.includes('"host"') && d.message.includes('"default"'),
    );
    expect(d).toBeDefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/server-variables")).toBe(false);
  });
});

describe("structure/encoding", () => {
  test("flags an encoding key with no matching schema property", async () => {
    const diagnostics = await lintFixture("structure/encoding-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/encoding" && d.message.includes("notAProperty"),
    );
    expect(d).toBeDefined();
  });

  test("flags a wrong-typed contentType", async () => {
    const diagnostics = await lintFixture("structure/encoding-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/encoding" && d.message.includes('"metadata"') && d.message.includes("contentType"),
    );
    expect(d).toBeDefined();
  });

  test("flags an invalid style value", async () => {
    const diagnostics = await lintFixture("structure/encoding-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/encoding" && d.message.includes('"metadata"') && d.message.includes('"style"'),
    );
    expect(d).toBeDefined();
  });

  test("flags non-boolean explode/allowReserved", async () => {
    const diagnostics = await lintFixture("structure/encoding-bad.yaml");
    const explodeDiag = diagnostics.find(
      (d) => d.rule === "structure/encoding" && d.message.includes('"metadata"') && d.message.includes('"explode"'),
    );
    const allowReservedDiag = diagnostics.find(
      (d) => d.rule === "structure/encoding" && d.message.includes('"metadata"') && d.message.includes('"allowReserved"'),
    );
    expect(explodeDiag).toBeDefined();
    expect(allowReservedDiag).toBeDefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/encoding")).toBe(false);
  });
});

describe("structure/xml", () => {
  test("flags an unknown key", async () => {
    const diagnostics = await lintFixture("structure/xml-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/xml" && d.message.includes("unknownKey"));
    expect(d).toBeDefined();
  });

  test("flags a wrong-typed name", async () => {
    const diagnostics = await lintFixture("structure/xml-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/xml" && d.message.includes("xml.name"));
    expect(d).toBeDefined();
  });

  test("flags a namespace that isn't an absolute URI", async () => {
    const diagnostics = await lintFixture("structure/xml-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/xml" && d.message.includes("xml.namespace"));
    expect(d).toBeDefined();
  });

  test("flags a non-boolean attribute", async () => {
    const diagnostics = await lintFixture("structure/xml-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/xml" && d.message.includes("xml.attribute"));
    expect(d).toBeDefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/xml")).toBe(false);
  });
});

describe("structure/examples", () => {
  test("flags value and externalValue together on a component example", async () => {
    const diagnostics = await lintFixture("structure/examples-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/examples" && d.message.includes('"BadRootExample"') && d.message.includes("must not set both"),
    );
    expect(d).toBeDefined();
  });

  test("flags an unknown key on an inline parameter example", async () => {
    const diagnostics = await lintFixture("structure/examples-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/examples" && d.message.includes('"bad"') && d.message.includes("unknown key"),
    );
    expect(d).toBeDefined();
  });

  test("flags value and externalValue together on an inline parameter example", async () => {
    const diagnostics = await lintFixture("structure/examples-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/examples" && d.message.includes('"bad"') && d.message.includes("must not set both"),
    );
    expect(d).toBeDefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/examples")).toBe(false);
  });
});

describe("structure/discriminator", () => {
  test("flags a discriminator with no oneOf/anyOf/allOf", async () => {
    const diagnostics = await lintFixture("structure/discriminator-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes("none of"),
    );
    expect(d).toBeDefined();
  });

  test("flags a missing propertyName", async () => {
    const diagnostics = await lintFixture("structure/discriminator-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes("missing required field \"propertyName\""),
    );
    expect(d).toBeDefined();
  });

  test("flags an unresolvable mapping target", async () => {
    const diagnostics = await lintFixture("structure/discriminator-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes("NoSuchSchema"),
    );
    expect(d).toBeDefined();
  });

  test("does not flag a resolvable mapping target", async () => {
    const diagnostics = await lintFixture("structure/discriminator-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes('"cat"'),
    );
    expect(d).toBeUndefined();
  });

  test("flags a oneOf branch missing the discriminator property", async () => {
    const diagnostics = await lintFixture("structure/discriminator-bad.yaml");
    // NoPropertyBranch (lines 68-72, 1-indexed) is the branch missing "petType".
    const d = diagnostics.find(
      (d) =>
        d.rule === "structure/discriminator" &&
        d.message.includes("is not defined in") &&
        d.range.start.line >= 67 &&
        d.range.start.line <= 71,
    );
    expect(d).toBeDefined();
  });

  test("flags a 3.0 branch where the discriminator property is not required", async () => {
    const diagnostics = await lintFixture("structure/discriminator-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes("must be listed in \"required\""),
    );
    expect(d).toBeDefined();
  });

  test("does not require the discriminator property to be required in 3.1", async () => {
    const diagnostics = await lintFixture("structure/discriminator-31-required-ok.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes("required"),
    );
    expect(d).toBeUndefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/discriminator")).toBe(false);
  });
});

describe("structure/callbacks", () => {
  test("flags a callback expression that doesn't look like a runtime expression or URL", async () => {
    const diagnostics = await lintFixture("structure/callbacks-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/callbacks" && d.message.includes("notAnExpression"),
    );
    expect(d).toBeDefined();
  });

  test("flags an invalid key in a callback path item", async () => {
    const diagnostics = await lintFixture("structure/callbacks-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/callbacks" && d.message.includes('"fetch"'),
    );
    expect(d).toBeDefined();
  });

  test("flags a callback operation missing responses", async () => {
    const diagnostics = await lintFixture("structure/callbacks-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/callbacks" && d.message.includes("missingResponses") && d.message.includes("responses"),
    );
    expect(d).toBeDefined();
  });

  test("does not flag a well-formed callback", async () => {
    const diagnostics = await lintFixture("structure/callbacks-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/callbacks" && d.message.includes("onData"),
    );
    expect(d).toBeUndefined();
  });

  test("checks components/callbacks too", async () => {
    const diagnostics = await lintFixture("structure/callbacks-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/callbacks" && d.message.includes("ReusableCallback"),
    );
    expect(d).toBeUndefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/callbacks")).toBe(false);
  });
});

describe("structure/links", () => {
  test("flags both operationRef and operationId set", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("BothSet") && d.message.includes("must not set both"),
    );
    expect(d).toBeDefined();
  });

  test("flags neither operationRef nor operationId set", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("NeitherSet") && d.message.includes("exactly one"),
    );
    expect(d).toBeDefined();
  });

  test("flags an operationId that doesn't exist", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("doesNotExist"),
    );
    expect(d).toBeDefined();
  });

  test("flags an unresolvable local operationRef", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("BadRef") && d.message.includes("does not resolve"),
    );
    expect(d).toBeDefined();
  });

  test("does not flag a resolvable local operationRef", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("GoodRef"),
    );
    expect(d).toBeUndefined();
  });

  test("flags an unknown key", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("notAKey"),
    );
    expect(d).toBeDefined();
  });

  test("checks components/links too", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("alsoDoesNotExist"),
    );
    expect(d).toBeDefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/links")).toBe(false);
  });
});

describe("structure/discriminator and structure/links across $ref'd multi-file documents", () => {
  test("flags an unresolvable discriminator mapping target and an unresolvable link operationId, each in the file that defines them", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/structure-multifile-v2/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const config = resolveConfig(undefined);
    const diagnostics = lint(graph, config);

    const mappingDiag = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes("MissingDog"),
    );
    expect(mappingDiag).toBeDefined();
    expect(mappingDiag?.range.filePath).toContain("entry.yaml");

    const okMappingDiag = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes('"cat"'),
    );
    expect(okMappingDiag).toBeUndefined();

    const linkDiag = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("unknownOperation"),
    );
    expect(linkDiag).toBeDefined();
    expect(linkDiag?.range.filePath).toContain("responses.yaml");

    const goodLinkDiag = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("GetPet") && d.message.includes("does not match"),
    );
    expect(goodLinkDiag).toBeUndefined();
  });
});

describe("structure rules across $ref'd multi-file documents", () => {
  test("flags a $ref'd security scheme and a $ref'd example", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/structure-multifile/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const config = resolveConfig(undefined);
    const diagnostics = lint(graph, config);

    const schemeDiag = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"ApiKeyAuth"'),
    );
    expect(schemeDiag).toBeDefined();
    expect(schemeDiag?.range.filePath).toContain("security-schemes.yaml");

    const exampleDiag = diagnostics.find(
      (d) => d.rule === "structure/examples" && d.message.includes('"pet"') && d.message.includes("must not set both"),
    );
    expect(exampleDiag).toBeDefined();
    expect(exampleDiag?.range.filePath).toContain("examples.yaml");
  });
});
