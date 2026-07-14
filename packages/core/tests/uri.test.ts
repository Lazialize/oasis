import { describe, expect, test } from "bun:test";
import { classifyUriReference, isExternalUriReference, uriScheme } from "../src/uri.ts";

describe("URI reference classification (issue #26)", () => {
  test("uriScheme extracts schemes, including schemes without //", () => {
    expect(uriScheme("https://example.com/x")).toBe("https");
    expect(uriScheme("urn:example:foo")).toBe("urn");
    expect(uriScheme("file:///abs/path.yaml")).toBe("file");
    expect(uriScheme("HTTP://X")).toBe("http");
  });

  test("uriScheme rejects single-letter schemes (Windows drive paths) and non-schemes", () => {
    expect(uriScheme("C:/shared/pet.yaml")).toBeUndefined();
    expect(uriScheme("C:\\shared\\pet.yaml")).toBeUndefined();
    expect(uriScheme("./shared.yaml")).toBeUndefined();
    expect(uriScheme("shared.yaml")).toBeUndefined();
    expect(uriScheme("#/components/schemas/Foo")).toBeUndefined();
  });

  test("classifyUriReference distinguishes fragment / relative / absolute", () => {
    expect(classifyUriReference("#/components/schemas/Foo")).toBe("fragment");
    expect(classifyUriReference("#PlainAnchor")).toBe("fragment");
    expect(classifyUriReference("./shared.yaml#/x")).toBe("relative");
    expect(classifyUriReference("../a/b.yaml")).toBe("relative");
    expect(classifyUriReference("https://example.com/s.json#/x")).toBe("absolute");
    expect(classifyUriReference("urn:example:foo")).toBe("absolute");
  });

  test("isExternalUriReference is true for non-file absolute URIs only", () => {
    expect(isExternalUriReference("https://example.com/s.json")).toBe(true);
    expect(isExternalUriReference("urn:example:foo")).toBe(true);
    expect(isExternalUriReference("file:///abs/x.yaml")).toBe(false);
    expect(isExternalUriReference("./shared.yaml")).toBe(false);
    expect(isExternalUriReference("#/x")).toBe(false);
    expect(isExternalUriReference("C:/shared/x.yaml")).toBe(false);
  });
});
