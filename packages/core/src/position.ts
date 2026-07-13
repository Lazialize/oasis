import type { LineCounter } from "yaml";
import type { Position, Range } from "./types.ts";

/** Convert a raw string offset to a zero-based line/character position. */
export function positionAtOffset(lineCounter: LineCounter, offset: number): Position {
  const { line, col } = lineCounter.linePos(offset);
  return { line: line - 1, character: col - 1 };
}

/**
 * Convert a zero-based line/character position back to a raw string offset. Out-of-range positions
 * are clamped: a line past the end maps to the last line, and a character past the line's end maps
 * to the end of that line (or the end of the document for the final line).
 */
export function offsetAtPosition(lineCounter: LineCounter, position: Position): number {
  const lineStarts = lineCounter.lineStarts;
  if (lineStarts.length === 0) return Math.max(0, position.character);

  const lineIdx = Math.min(Math.max(position.line, 0), lineStarts.length - 1);
  const lineStart = lineStarts[lineIdx] ?? 0;
  const char = Math.max(position.character, 0);
  const offset = lineStart + char;

  // Clamp the character to the line's end: the start of the next line (minus its newline). The
  // last line has no known upper bound here, so its character is left unclamped.
  const nextLineStart = lineStarts[lineIdx + 1];
  if (nextLineStart !== undefined) return Math.min(offset, nextLineStart - 1);
  return offset;
}

export function rangeFromOffsets(
  filePath: string,
  lineCounter: LineCounter,
  startOffset: number,
  endOffset: number,
): Range {
  return {
    filePath,
    start: positionAtOffset(lineCounter, startOffset),
    end: positionAtOffset(lineCounter, endOffset),
    startOffset,
    endOffset,
  };
}

/** A degenerate zero-length range at the start of a file, used when no better range is available. */
export function zeroRange(filePath: string): Range {
  return {
    filePath,
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
    startOffset: 0,
    endOffset: 0,
  };
}
