import { describe, expect, test } from "bun:test";
import { escapePointerSegment, formatPointer, parsePointer, unescapePointerSegment } from "../src/pointer.ts";

describe("JSON Pointer escaping", () => {
  test("escapes ~ and /", () => {
    expect(escapePointerSegment("a/b")).toBe("a~1b");
    expect(escapePointerSegment("a~b")).toBe("a~0b");
    expect(escapePointerSegment("~/")).toBe("~0~1");
  });

  test("unescapes ~1 and ~0, in the correct order", () => {
    expect(unescapePointerSegment("a~1b")).toBe("a/b");
    expect(unescapePointerSegment("a~0b")).toBe("a~b");
    expect(unescapePointerSegment("~0~1")).toBe("~/");
  });

  test("round-trips arbitrary segments", () => {
    const seg = "/users/{id}";
    expect(unescapePointerSegment(escapePointerSegment(seg))).toBe(seg);
  });
});

describe("parsePointer / formatPointer", () => {
  test("parses a simple pointer", () => {
    expect(parsePointer("/paths/~1users/get")).toEqual(["paths", "/users", "get"]);
  });

  test("parses the root pointer", () => {
    expect(parsePointer("")).toEqual([]);
  });

  test("round-trips through formatPointer", () => {
    const pointer = "/paths/~1users~1{id}/get/summary";
    expect(formatPointer(parsePointer(pointer))).toBe(pointer);
  });

  test("formatPointer of no segments is the empty string", () => {
    expect(formatPointer([])).toBe("");
  });
});

describe("formatPointer / parsePointer inverse property", () => {
  test("round-trips a segment containing a literal % followed by hex digits", () => {
    const segments = ["components", "schemas", "Foo%41Bar"];
    expect(parsePointer(formatPointer(segments))).toEqual(segments);
  });

  test("encodes only the corruptible case, keeping other % literal", () => {
    // "%zz" / a trailing "%" survive safeDecodeURIComponent unchanged, so they stay unencoded.
    expect(formatPointer(["a", "100%"])).toBe("/a/100%");
    expect(formatPointer(["a", "%zz"])).toBe("/a/%zz");
    expect(formatPointer(["a", "%41"])).toBe("/a/%2541");
    expect(parsePointer(formatPointer(["a", "100%"]))).toEqual(["a", "100%"]);
    expect(parsePointer(formatPointer(["a", "%zz"]))).toEqual(["a", "%zz"]);
  });

  test("round-trips ~, /, unicode, and mixed segments", () => {
    for (const segments of [
      ["a~b", "c/d"],
      ["日本語", "emoji 🐫"],
      ["%7E0", "~0", "%2F"],
      [""],
    ]) {
      expect(parsePointer(formatPointer(segments))).toEqual(segments);
    }
  });
});

describe("percent-decoding (URI-encoded $ref fragments)", () => {
  test("percent-decodes a segment before applying ~ unescaping", () => {
    // "%7E0" percent-decodes to the literal text "~0", which is then unescaped as a JSON Pointer
    // escape to "~" -- same final result as writing the escape directly, unencoded.
    expect(parsePointer("/a/%7E0")).toEqual(["a", "~"]);
    expect(parsePointer("/a/~0")).toEqual(["a", "~"]);
  });

  test("percent-decodes a plain (non ~-escaped) segment", () => {
    expect(parsePointer("/pet%20store/Foo")).toEqual(["pet store", "Foo"]);
  });

  test("a malformed percent-encoding is treated as literal text instead of throwing", () => {
    expect(() => parsePointer("/a%/b")).not.toThrow();
    expect(parsePointer("/a%/b")).toEqual(["a%", "b"]);
  });
});
