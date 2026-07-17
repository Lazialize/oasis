export type { Diagnostic, DiagnosticSeverity, Position, Range } from "./types.ts";

export type { OasisDocument } from "./parse.ts";
export { parseDocument } from "./parse.ts";

export { PreciseNumber, preserveNumericLiteral } from "./number.ts";

export type { PointerLookupResult, PositionLookupResult } from "./document.ts";
export { nodeAtPointer, nodeAtPosition } from "./document.ts";

export { escapePointerSegment, formatPointer, parseFragmentPointer, parsePointer, unescapePointerSegment } from "./pointer.ts";

export type { OpenApiVersion } from "./version.ts";
export { detectVersion } from "./version.ts";

export {
  isNamedEntryContainer,
  NAMED_ENTRY_CONTAINER_KEYS,
  NAMED_ENTRY_CONTAINER_KEYS_31,
} from "./named-containers.ts";

export type { FileSystem } from "./filesystem.ts";
export { InMemoryFileSystem, NodeFileSystem, resolveFileReference } from "./filesystem.ts";

export type { FoundRef, OpenApiObjectKind, ReferenceKind, RefParts, ResolvedRef, ResolveRefResult, UnresolvedRef } from "./ref.ts";
export {
  CONTAINER_KEYS,
  findRefs,
  foundRefForNode,
  findSubtreeRefs,
  isContainerKey,
  isLiteralDataKey,
  looksLikeMappingRef,
  parseRefString,
  resolveRef,
} from "./ref.ts";

export type { UriReferenceKind } from "./uri.ts";
export { classifyUriReference, FILESYSTEM_URI_SCHEMES, isExternalUriReference, uriScheme } from "./uri.ts";
export { resolveUriReference, stripUriFragment } from "./uri.ts";

export type { AnchorEntry, AnchorIndex } from "./anchor.ts";
export { buildAnchorIndex, resolveAnchor } from "./anchor.ts";

export type { WorkspaceGraph } from "./graph.ts";
export { allDiagnostics, graphReferences, loadWorkspaceGraph } from "./graph.ts";

export { offsetAtPosition, positionAtOffset, rangeFromOffsets, zeroRange } from "./position.ts";

export type { FileSuppressions, SuppressedRules } from "./suppressions.ts";
export { extractSuppressions, isSuppressed } from "./suppressions.ts";

export { childAt, keyToString, resolveAlias } from "./walk.ts";

export type { ComponentSection } from "./components.ts";
export { COMPONENT_SECTIONS } from "./components.ts";
