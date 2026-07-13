import { describe, expect, test } from "bun:test";
import { parseDocument } from "../src/parse.ts";
import { detectVersion } from "../src/version.ts";

function doc(openapi: string | undefined): ReturnType<typeof parseDocument> {
  const text = openapi === undefined ? "info:\n  title: x\n" : `openapi: "${openapi}"\ninfo:\n  title: x\n`;
  return parseDocument(text, "/virtual/doc.yaml");
}

// Helper to create YAML with unquoted (numeric) openapi values
function docUnquoted(openapi: string | undefined): ReturnType<typeof parseDocument> {
  const text = openapi === undefined ? "info:\n  title: x\n" : `openapi: ${openapi}\ninfo:\n  title: x\n`;
  return parseDocument(text, "/virtual/doc.yaml");
}

describe("detectVersion", () => {
  test("detects 3.0.x with patch version", () => {
    expect(detectVersion(doc("3.0.0"))).toBe("3.0");
    expect(detectVersion(doc("3.0.3"))).toBe("3.0");
    expect(detectVersion(doc("3.0.4"))).toBe("3.0");
  });

  test("detects 3.0 without patch version (patch-less)", () => {
    expect(detectVersion(doc("3.0"))).toBe("3.0");
  });

  test("detects 3.1.x with patch version", () => {
    expect(detectVersion(doc("3.1.0"))).toBe("3.1");
    expect(detectVersion(doc("3.1.5"))).toBe("3.1");
    expect(detectVersion(doc("3.1.2"))).toBe("3.1");
  });

  test("detects 3.1 without patch version (patch-less)", () => {
    expect(detectVersion(doc("3.1"))).toBe("3.1");
  });

  test("rejects versions like 3.10.0 that resemble 3.1 but are different", () => {
    // 3.10 should NOT match 3.1; the regex ensures the minor version is exactly 1, not 10
    expect(detectVersion(doc("3.10.0"))).toBeUndefined();
    expect(detectVersion(doc("3.10"))).toBeUndefined();
  });

  test("handles prerelease versions with hyphen", () => {
    expect(detectVersion(doc("3.0.0-rc1"))).toBe("3.0");
    expect(detectVersion(doc("3.1.0-rc1"))).toBe("3.1");
    expect(detectVersion(doc("3.0-rc1"))).toBe("3.0");
    expect(detectVersion(doc("3.1-rc1"))).toBe("3.1");
  });

  test("handles YAML unquoted numbers (coerced to strings)", () => {
    // YAML unquoted 3.1 is parsed as the number 3.1, which stringifies as "3.1"
    expect(detectVersion(docUnquoted("3.1"))).toBe("3.1");
    // Note: YAML unquoted 3.0 becomes the number 3.0, which stringifies as "3" in JavaScript.
    // This edge case is not supported since "3" does not match our regex.
    expect(detectVersion(docUnquoted("3.0"))).toBeUndefined();
  });

  test("returns undefined when the field is absent", () => {
    expect(detectVersion(doc(undefined))).toBeUndefined();
  });

  test("returns undefined for invalid/unsupported versions", () => {
    expect(detectVersion(doc("2.0"))).toBeUndefined();
    expect(detectVersion(doc("4.0.0"))).toBeUndefined();
    expect(detectVersion(doc("not-a-version"))).toBeUndefined();
    expect(detectVersion(doc("3"))).toBeUndefined();
    expect(detectVersion(doc("3.2"))).toBeUndefined();
  });
});
