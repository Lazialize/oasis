import { describe, expect, test } from "bun:test";
import { parseDocument } from "../src/parse.ts";
import { detectVersion } from "../src/version.ts";

function doc(openapi: string | undefined): ReturnType<typeof parseDocument> {
  const text = openapi === undefined ? "info:\n  title: x\n" : `openapi: "${openapi}"\ninfo:\n  title: x\n`;
  return parseDocument(text, "/virtual/doc.yaml");
}

describe("detectVersion", () => {
  test("detects 3.0.x", () => {
    expect(detectVersion(doc("3.0.0"))).toBe("3.0");
    expect(detectVersion(doc("3.0.3"))).toBe("3.0");
  });

  test("detects 3.1.x", () => {
    expect(detectVersion(doc("3.1.0"))).toBe("3.1");
    expect(detectVersion(doc("3.1.5"))).toBe("3.1");
  });

  test("returns undefined when the field is absent", () => {
    expect(detectVersion(doc(undefined))).toBeUndefined();
  });

  test("returns undefined for an invalid/unsupported version", () => {
    expect(detectVersion(doc("2.0"))).toBeUndefined();
    expect(detectVersion(doc("4.0.0"))).toBeUndefined();
    expect(detectVersion(doc("not-a-version"))).toBeUndefined();
  });
});
