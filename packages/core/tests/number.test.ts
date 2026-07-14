import { describe, expect, test } from "bun:test";
import { PreciseNumber, preserveNumericLiteral } from "../src/number.ts";

describe("preserveNumericLiteral", () => {
  test("wraps an integer past MAX_SAFE_INTEGER that the double rounds", () => {
    const rounded = Number("9007199254740993"); // 9007199254740992
    const result = preserveNumericLiteral(rounded, "9007199254740993");
    expect(result).toBeInstanceOf(PreciseNumber);
    expect((result as PreciseNumber).source).toBe("9007199254740993");
    // still usable as a number via valueOf
    expect(Number(result)).toBe(rounded);
  });

  test("wraps a high-precision decimal that loses digits", () => {
    const source = "3.14159265358979323846264338327950288";
    const result = preserveNumericLiteral(Number(source), source);
    expect(result).toBeInstanceOf(PreciseNumber);
    expect((result as PreciseNumber).source).toBe(source);
  });

  test("wraps an exponent-form high-precision decimal", () => {
    const source = "1.234567890123456789e-10";
    const result = preserveNumericLiteral(Number(source), source);
    expect(result).toBeInstanceOf(PreciseNumber);
  });

  test("passes through numbers that round-trip exactly", () => {
    expect(preserveNumericLiteral(42, "42")).toBe(42);
    expect(preserveNumericLiteral(0, "0")).toBe(0);
    expect(preserveNumericLiteral(0.5, "0.5")).toBe(0.5);
    expect(preserveNumericLiteral(-3.25, "-3.25")).toBe(-3.25);
  });

  test("treats cosmetic-only differences as exact (no wrapping)", () => {
    expect(preserveNumericLiteral(1, "1.0")).toBe(1);
    expect(preserveNumericLiteral(1000, "1e3")).toBe(1000);
    expect(preserveNumericLiteral(1.5, "1.50")).toBe(1.5);
    expect(preserveNumericLiteral(0.5, ".5")).toBe(0.5);
    expect(preserveNumericLiteral(100000000000000000000, "1e20")).toBe(100000000000000000000);
  });

  test("does not wrap non-decimal literal forms (hex/octal): normalized decimal value is emitted", () => {
    expect(preserveNumericLiteral(31, "0x1F")).toBe(31);
    expect(preserveNumericLiteral(15, "0o17")).toBe(15);
    // even a hex literal past 2^53 must not be wrapped — its source can't be spliced into JSON
    expect(preserveNumericLiteral(Number(0x20000000000001n), "0x20000000000001")).toBe(9007199254740992);
  });

  test("does not wrap when source is unavailable or value is non-finite", () => {
    expect(preserveNumericLiteral(5, undefined)).toBe(5);
    expect(preserveNumericLiteral(Infinity, ".inf")).toBe(Infinity);
    expect(Number.isNaN(preserveNumericLiteral(NaN, ".nan") as number)).toBe(true);
  });
});
