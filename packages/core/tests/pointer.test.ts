import { describe, expect, test } from "bun:test";
import {
  canonicalPointer,
  escapePointerSegment,
  formatPointer,
  parseFragmentPointer,
  parsePointer,
  unescapePointerSegment,
} from "../src/pointer.ts";

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
    const segments = parsePointer(pointer);
    expect(segments).toBeDefined();
    expect(formatPointer(segments!)).toBe(pointer);
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
    const plainSegments = parsePointer("/pets/{id}");
    expect(plainSegments).toBeDefined();
    expect(parseFragmentPointer("/pets/%7Bid%7D")).toEqual(plainSegments!);
  });

  test("parses the root fragment", () => {
    expect(parseFragmentPointer("")).toEqual([]);
  });

  test("an encoded '/' (%2F) inside a segment does not become a pointer separator", () => {
    expect(parseFragmentPointer("/a%2Fb/c")).toEqual(["a/b", "c"]);
  });
});

describe("parseFragmentPointer rejects malformed tilde escapes (issue #211)", () => {
  test("rejects a lone trailing tilde", () => {
    expect(parseFragmentPointer("/bad~")).toBeUndefined();
  });

  test("rejects a tilde followed by a digit other than 0 or 1", () => {
    expect(parseFragmentPointer("/components/schemas/a~2b")).toBeUndefined();
  });

  test("rejects a percent-encoded malformed tilde escape (%7E2 decodes to ~2)", () => {
    expect(parseFragmentPointer("/components/schemas/a%7E2b")).toBeUndefined();
  });

  test("still accepts a valid ~0 escape", () => {
    expect(parseFragmentPointer("/a/~0b")).toEqual(["a", "~b"]);
  });

  test("still accepts a valid ~1 escape", () => {
    expect(parseFragmentPointer("/a/~1b")).toEqual(["a", "/b"]);
  });

  test("still accepts a percent-encoded valid ~0 escape", () => {
    expect(parseFragmentPointer("/a/%7E0b")).toEqual(["a", "~b"]);
  });
});

describe("canonicalPointer propagates a malformed fragment as undefined (issue #211)", () => {
  test("returns undefined for a malformed tilde escape", () => {
    expect(canonicalPointer("/components/schemas/a~2b")).toBeUndefined();
  });

  test("returns undefined for a percent-encoded malformed tilde escape", () => {
    expect(canonicalPointer("/components/schemas/a%7E2b")).toBeUndefined();
  });

  test("still canonicalizes a valid fragment", () => {
    expect(canonicalPointer("/components/schemas/%46oo")).toBe("/components/schemas/Foo");
  });
});

describe("parsePointer RFC 6901 validation (plain pointer, no URI decoding)", () => {
  test("rejects a non-empty pointer without a leading slash", () => {
    expect(parsePointer("foo")).toBeUndefined();
    expect(parsePointer("foo/bar")).toBeUndefined();
    expect(parsePointer("paths")).toBeUndefined();
  });

  test("rejects malformed tilde escapes (~2, ~3, etc.)", () => {
    expect(parsePointer("/bad~2escape")).toBeUndefined();
    expect(parsePointer("/bad~3escape")).toBeUndefined();
    expect(parsePointer("/path/~5")).toBeUndefined();
  });

  test("rejects trailing tilde without escape", () => {
    expect(parsePointer("/trailing~")).toBeUndefined();
    expect(parsePointer("/a/b~")).toBeUndefined();
  });

  test("rejects tilde not followed by valid escape code", () => {
    expect(parsePointer("/bad~a")).toBeUndefined();
    expect(parsePointer("/bad~ 1")).toBeUndefined();
    expect(parsePointer("/~x")).toBeUndefined();
  });

  test("accepts valid empty pointer", () => {
    expect(parsePointer("")).toEqual([]);
  });

  test("accepts valid root pointer with single segment", () => {
    expect(parsePointer("/foo")).toEqual(["foo"]);
  });

  test("accepts valid escaped slash (~/1)", () => {
    expect(parsePointer("/paths/~1users")).toEqual(["paths", "/users"]);
  });

  test("accepts valid escaped tilde (~0)", () => {
    expect(parsePointer("/a/~0b")).toEqual(["a", "~b"]);
  });

  test("accepts both escapes in same segment", () => {
    expect(parsePointer("/a/~0~1b")).toEqual(["a", "~/b"]);
  });

  test("preserves existing valid round-trip behavior", () => {
    const pointer = "/paths/~1users~1{id}/get/summary";
    const segments = parsePointer(pointer);
    expect(segments).toBeDefined();
    expect(formatPointer(segments!)).toBe(pointer);
  });

  test("accepts pointer with multiple valid segments", () => {
    expect(parsePointer("/components/schemas/Pet")).toEqual(["components", "schemas", "Pet"]);
  });

  test("accepts empty string segment (double slash)", () => {
    expect(parsePointer("/a//b")).toEqual(["a", "", "b"]);
  });
});
