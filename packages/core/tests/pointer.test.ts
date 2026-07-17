import { describe, expect, test } from "bun:test";
import { escapePointerSegment, formatPointer, parseFragmentPointer, parsePointer, unescapePointerSegment } from "../src/pointer.ts";

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

describe("parsePointer / formatPointer (plain RFC 6901, no URI decoding)", () => {
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

  test("does not percent-decode a segment", () => {
    // Percent-encoding is a URI-fragment concern, not part of plain RFC 6901; a literal "%7Bid%7D"
    // key must round-trip as itself, never as the distinct key "{id}" (issue #96).
    expect(parsePointer("/pets/%7Bid%7D")).toEqual(["pets", "%7Bid%7D"]);
    expect(parsePointer("/pet%20store/Foo")).toEqual(["pet%20store", "Foo"]);
  });

  test("formatPointer does not add compensating percent-encoding", () => {
    expect(formatPointer(["a", "%41"])).toBe("/a/%41");
    expect(formatPointer(["pets", "%7Bid%7D"])).toBe("/pets/%7Bid%7D");
  });
});

describe("formatPointer / parsePointer inverse property (plain RFC 6901)", () => {
  test("round-trips a segment containing a literal % followed by hex digits", () => {
    const segments = ["components", "schemas", "Foo%41Bar"];
    expect(parsePointer(formatPointer(segments))).toEqual(segments);
  });

  test("round-trips ~, /, unicode, percent-escape-looking, and mixed segments", () => {
    for (const segments of [
      ["a~b", "c/d"],
      ["日本語", "emoji 🐫"],
      ["%7E0", "~0", "%2F"],
      ["pets", "{id}"],
      ["pets", "%7Bid%7D"],
      [""],
    ]) {
      expect(parsePointer(formatPointer(segments))).toEqual(segments);
    }
  });

  test("distinguishes a literal '{id}' key from a literal '%7Bid%7D' key", () => {
    // The exact scenario from issue #96: two distinct sibling keys that must never collide.
    const braceKey = formatPointer(["paths", "/pets/{id}"]);
    const percentKey = formatPointer(["paths", "/pets/%7Bid%7D"]);
    expect(braceKey).not.toBe(percentKey);
    expect(parsePointer(braceKey)).toEqual(["paths", "/pets/{id}"]);
    expect(parsePointer(percentKey)).toEqual(["paths", "/pets/%7Bid%7D"]);
  });
});

describe("parseFragmentPointer ($ref URI fragments: one percent-decode, then RFC 6901)", () => {
  test("percent-decodes a segment before applying ~ unescaping", () => {
    // "%7E0" percent-decodes to the literal text "~0", which is then unescaped as a JSON Pointer
    // escape to "~" -- same final result as writing the escape directly, unencoded.
    expect(parseFragmentPointer("/a/%7E0")).toEqual(["a", "~"]);
    expect(parseFragmentPointer("/a/~0")).toEqual(["a", "~"]);
  });

  test("percent-decodes a plain (non ~-escaped) segment", () => {
    expect(parseFragmentPointer("/pet%20store/Foo")).toEqual(["pet store", "Foo"]);
  });

  test("a malformed percent-encoding is treated as literal text instead of throwing", () => {
    expect(() => parseFragmentPointer("/a%/b")).not.toThrow();
    expect(parseFragmentPointer("/a%/b")).toEqual(["a%", "b"]);
  });

  test("resolves a fragment pointer to the same segments plain parsePointer would give for the unencoded form", () => {
    expect(parseFragmentPointer("/pets/%7Bid%7D")).toEqual(parsePointer("/pets/{id}"));
  });

  test("parses the root fragment", () => {
    expect(parseFragmentPointer("")).toEqual([]);
  });

  test("an encoded '/' (%2F) inside a segment does not become a pointer separator", () => {
    expect(parseFragmentPointer("/a%2Fb/c")).toEqual(["a/b", "c"]);
  });
});
