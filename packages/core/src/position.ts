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
 * to the end of that line (before any CRLF/LF terminator), or the end of the document for the final
 * line. The source text is required to determine both the document's true length and whether each
 * line ends in `\r\n` or `\n`, neither of which `lineCounter.lineStarts` alone can tell us.
 */
export function offsetAtPosition(lineCounter: LineCounter, text: string, position: Position): number {
  const lineStarts = lineCounter.lineStarts;
  if (lineStarts.length === 0) return Math.min(Math.max(position.character, 0), text.length);

  const lineIdx = Math.min(Math.max(position.line, 0), lineStarts.length - 1);
  const lineStart = lineStarts[lineIdx] ?? 0;
  const char = Math.max(position.character, 0);

  // Clamp the character to the line's end. For a non-final line, that's the start of the next line
  // minus its newline sequence (`\n`, or `\r\n` if the line is CRLF-terminated). The final line's
  // end is the end of the document.
  const nextLineStart = lineStarts[lineIdx + 1];
  let lineEnd: number;
  if (nextLineStart !== undefined) {
    lineEnd = nextLineStart - 1;
    if (lineEnd - 1 >= lineStart && text[lineEnd - 1] === "\r") lineEnd -= 1;
  } else {
    lineEnd = text.length;
  }

  const offset = Math.min(lineStart + char, lineEnd);
  return Math.min(Math.max(offset, 0), text.length);
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
