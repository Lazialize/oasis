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
  const text = "abc\ndef\nghi"; // lines start at 0, 4, 8; length 11
  const lc = counterFor(text);

  test("in-range position maps normally", () => {
    expect(offsetAtPosition(lc, text, { line: 1, character: 1 })).toBe(5);
  });

  test("line past the end clamps to the last line", () => {
    // last line starts at offset 8; character 0 -> 8 (not 0 + character)
    expect(offsetAtPosition(lc, text, { line: 99, character: 0 })).toBe(8);
  });

  test("character past the line's end clamps to end of that line", () => {
    // line 0 is "abc" (offsets 0..3, newline at 3); clamp to 3
    expect(offsetAtPosition(lc, text, { line: 0, character: 999 })).toBe(3);
  });

  test("negative line/character clamp to zero", () => {
    expect(offsetAtPosition(lc, text, { line: -5, character: -5 })).toBe(0);
  });

  test("oversized character on the final line clamps to the document length", () => {
    expect(offsetAtPosition(lc, text, { line: 2, character: 999 })).toBe(11);
  });

  test("oversized line and character together clamp to the document length", () => {
    expect(offsetAtPosition(lc, text, { line: 99, character: 999 })).toBe(11);
  });

  test("final line with a trailing newline clamps to the document length", () => {
    const withTrailingNewline = "abc\ndef\nghi\n"; // length 12
    const lcTrailing = counterFor(withTrailingNewline);
    // trailing newline creates a final, empty 4th line starting at offset 12
    expect(offsetAtPosition(lcTrailing, withTrailingNewline, { line: 3, character: 999 })).toBe(12);
  });

  describe("CRLF line endings", () => {
    const crlfText = "abc\r\ndef"; // line 0 is "abc" ending in CRLF at offsets 3-4; line 1 is "def"
    const crlfLc = counterFor(crlfText);

    test("oversized character clamps to before the CRLF sequence", () => {
      expect(offsetAtPosition(crlfLc, crlfText, { line: 0, character: 999 })).toBe(3);
    });

    test("in-range character on a CRLF line maps normally", () => {
      expect(offsetAtPosition(crlfLc, crlfText, { line: 0, character: 1 })).toBe(1);
    });

    test("oversized character on the final line clamps to the document length", () => {
      expect(offsetAtPosition(crlfLc, crlfText, { line: 1, character: 999 })).toBe(8);
    });
  });

  test("empty document clamps to offset zero", () => {
    const emptyText = "";
    const emptyLc = counterFor(emptyText);
    expect(offsetAtPosition(emptyLc, emptyText, { line: 0, character: 0 })).toBe(0);
    expect(offsetAtPosition(emptyLc, emptyText, { line: 5, character: 5 })).toBe(0);
  });

  test("single-line document clamps to the document length", () => {
    const singleLine = "hello";
    const singleLc = counterFor(singleLine);
    expect(offsetAtPosition(singleLc, singleLine, { line: 0, character: 999 })).toBe(5);
    expect(offsetAtPosition(singleLc, singleLine, { line: 5, character: 999 })).toBe(5);
  });

  test("invariant: every result is within [0, text.length]", () => {
    const samples = ["abc\ndef\nghi", "abc\r\ndef", "", "hello", "abc\ndef\nghi\n", "\r\n\r\n"];
    for (const sample of samples) {
      const sampleLc = counterFor(sample);
      for (let line = -2; line < 6; line++) {
        for (let character = -2; character < 1000; character += 137) {
          const offset = offsetAtPosition(sampleLc, sample, { line, character });
          expect(offset).toBeGreaterThanOrEqual(0);
          expect(offset).toBeLessThanOrEqual(sample.length);
        }
      }
    }
  });
});
