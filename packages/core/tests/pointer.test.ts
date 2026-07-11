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
