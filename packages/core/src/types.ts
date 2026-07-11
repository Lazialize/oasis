/** Zero-based line/character position, matching LSP conventions. */
export interface Position {
  line: number;
  character: number;
}

/** A source range within a specific file, with both line/character and raw offsets. */
export interface Range {
  filePath: string;
  start: Position;
  end: Position;
  startOffset: number;
  endOffset: number;
}

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface Diagnostic {
  message: string;
  severity: DiagnosticSeverity;
  range: Range;
  /** Machine-readable diagnostic code, e.g. "duplicate-key", "unresolved-ref", "ref-cycle". */
  code?: string;
  /** Origin of the diagnostic, e.g. "core", "yaml". */
  source?: string;
}
