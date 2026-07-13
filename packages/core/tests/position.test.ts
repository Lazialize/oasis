import { describe, expect, test } from "bun:test";
import { LineCounter } from "yaml";
import { offsetAtPosition } from "../src/position.ts";

function counterFor(text: string): LineCounter {
  const lc = new LineCounter();
  // The yaml parser records the start of the first line (offset 0) plus the start of each
  // subsequent line; mirror that here.
  lc.addNewLine(0);
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lc.addNewLine(i + 1);
  }
  return lc;
}

describe("offsetAtPosition clamping", () => {
  const text = "abc\ndef\nghi"; // lines start at 0, 4, 8
  const lc = counterFor(text);

  test("in-range position maps normally", () => {
    expect(offsetAtPosition(lc, { line: 1, character: 1 })).toBe(5);
  });

  test("line past the end clamps to the last line", () => {
    // last line starts at offset 8; character 0 -> 8 (not 0 + character)
    expect(offsetAtPosition(lc, { line: 99, character: 0 })).toBe(8);
  });

  test("character past the line's end clamps to end of that line", () => {
    // line 0 is "abc" (offsets 0..3, newline at 3); clamp to 3
    expect(offsetAtPosition(lc, { line: 0, character: 999 })).toBe(3);
  });

  test("negative line/character clamp to zero", () => {
    expect(offsetAtPosition(lc, { line: -5, character: -5 })).toBe(0);
  });
});
