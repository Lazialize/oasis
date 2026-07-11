export type { Diagnostic, DiagnosticSeverity, Position, Range } from "./types.ts";

export type { OasisDocument } from "./parse.ts";
export { parseDocument } from "./parse.ts";

export type { PointerLookupResult, PositionLookupResult } from "./document.ts";
export { nodeAtPointer, nodeAtPosition } from "./document.ts";

export { escapePointerSegment, formatPointer, parsePointer, unescapePointerSegment } from "./pointer.ts";

export type { OpenApiVersion } from "./version.ts";
export { detectVersion } from "./version.ts";

export type { FileSystem } from "./filesystem.ts";
export { InMemoryFileSystem, NodeFileSystem } from "./filesystem.ts";

export type { FoundRef, RefParts, ResolvedRef, ResolveRefResult, UnresolvedRef } from "./ref.ts";
export { findRefs, parseRefString, resolveRef } from "./ref.ts";

export type { WorkspaceGraph } from "./graph.ts";
export { allDiagnostics, loadWorkspaceGraph } from "./graph.ts";

export { offsetAtPosition, positionAtOffset, rangeFromOffsets, zeroRange } from "./position.ts";

export type { FileSuppressions, SuppressedRules } from "./suppressions.ts";
export { extractSuppressions, isSuppressed } from "./suppressions.ts";
