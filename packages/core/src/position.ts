import type { LineCounter } from "yaml";
import type { Position, Range } from "./types.ts";

/** Convert a raw string offset to a zero-based line/character position. */
export function positionAtOffset(lineCounter: LineCounter, offset: number): Position {
  const { line, col } = lineCounter.linePos(offset);
  return { line: line - 1, character: col - 1 };
}

/** Convert a zero-based line/character position back to a raw string offset. */
export function offsetAtPosition(lineCounter: LineCounter, position: Position): number {
  const lineStarts = lineCounter.lineStarts;
  const lineStart = lineStarts[position.line] ?? 0;
  return lineStart + position.character;
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
