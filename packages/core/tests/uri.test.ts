import { describe, expect, test } from "bun:test";
import { classifyUriReference, isExternalUriReference, uriScheme } from "../src/uri.ts";

describe("URI reference classification (issue #26)", () => {
  test("uriScheme extracts schemes, including schemes without //", () => {
    expect(uriScheme("https://example.com/x")).toBe("https");
    expect(uriScheme("urn:example:foo")).toBe("urn");
    expect(uriScheme("file:///abs/path.yaml")).toBe("file");
    expect(uriScheme("HTTP://X")).toBe("http");
  });

  test("uriScheme accepts valid one-character URI schemes (RFC 3986)", () => {
    expect(uriScheme("x:thing")).toBe("x");
    expect(uriScheme("X:thing")).toBe("x");
    expect(uriScheme("a:opaque")).toBe("a");
    expect(uriScheme("z://hierarchical")).toBe("z");
  });

  test("uriScheme rejects Windows drive paths but not other single-letter schemes", () => {
    // Windows absolute paths should be rejected
    expect(uriScheme("C:/shared/pet.yaml")).toBeUndefined();
    expect(uriScheme("C:\\shared\\pet.yaml")).toBeUndefined();
    expect(uriScheme("D:\\file.txt")).toBeUndefined();
    expect(uriScheme("d:/file.txt")).toBeUndefined();
    // Non-Windows single-letter schemes should be accepted
    expect(uriScheme("x:thing")).toBe("x");
    // Relative paths and non-schemes should be rejected
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

  test("classifyUriReference recognizes one-character URI schemes as absolute", () => {
    expect(classifyUriReference("x:thing")).toBe("absolute");
    expect(classifyUriReference("a:opaque")).toBe("absolute");
  });

  test("drive-relative forms (no separator after the colon) are treated as URI schemes — explicit policy", () => {
    // Policy: only a single letter followed by `:` and a path separator (`\` or a single `/`) is
    // treated as a Windows drive path. A drive-relative form like `C:foo.yaml` (current-directory
    // relative on drive C, no separator) is indistinguishable from an opaque one-letter URI such
    // as `x:thing`, so it is deliberately classified as a URI with scheme `c`. Authors who mean a
    // drive-relative Windows path must write an explicit separator or a relative `./` path.
    expect(uriScheme("C:foo.yaml")).toBe("c");
    expect(classifyUriReference("C:foo.yaml")).toBe("absolute");
    expect(isExternalUriReference("C:foo.yaml")).toBe(true);
  });

  test("classifyUriReference treats Windows paths as relative", () => {
    expect(classifyUriReference("C:/shared/pet.yaml")).toBe("relative");
    expect(classifyUriReference("C:\\shared\\pet.yaml")).toBe("relative");
  });

  test("isExternalUriReference is true for non-file absolute URIs only", () => {
    expect(isExternalUriReference("https://example.com/s.json")).toBe(true);
    expect(isExternalUriReference("urn:example:foo")).toBe(true);
    expect(isExternalUriReference("file:///abs/x.yaml")).toBe(false);
    expect(isExternalUriReference("./shared.yaml")).toBe(false);
    expect(isExternalUriReference("#/x")).toBe(false);
    expect(isExternalUriReference("C:/shared/x.yaml")).toBe(false);
  });

  test("isExternalUriReference recognizes one-character URI schemes as external", () => {
    expect(isExternalUriReference("x:thing")).toBe(true);
    expect(isExternalUriReference("a:opaque")).toBe(true);
  });
});
