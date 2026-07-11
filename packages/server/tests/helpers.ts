import type { Position } from "@oasis/core";

/** Zero-based line/character position of the first occurrence of `needle` in `text`. */
export function positionOf(text: string, needle: string, occurrence = 0): Position {
  let searchFrom = 0;
  let index = -1;
  for (let i = 0; i <= occurrence; i++) {
    index = text.indexOf(needle, searchFrom);
    if (index === -1) throw new Error(`"${needle}" not found in text (occurrence ${i})`);
    searchFrom = index + 1;
  }
  const before = text.slice(0, index);
  const lines = before.split("\n");
  const line = lines.length - 1;
  const character = lines[lines.length - 1]!.length;
  return { line, character };
}
