export { runLspServer } from "./server.ts";
export { startServer } from "./connection.ts";

export type { ProjectState, ServerContext } from "./workspace.ts";
export { createServerContext, findOwningEntry, getGraph, getDocument, invalidateGraph, resolveEntryForPath } from "./workspace.ts";

export { OverlayFileSystem } from "./overlay-fs.ts";

export { looksLikeOpenApi } from "./openapi-guard.ts";

export {
  discoverProjectUpward,
  isConfigFilePath,
  loadConfigFilesFromInit,
  loadProjectAtPath,
  scanWorkspaceRootsForProjects,
} from "./project.ts";

export type { DocumentRoute } from "./document-routing.ts";
export { routeDocument } from "./document-routing.ts";

export type { ObjectKind } from "./keywords.ts";
export { allowedKeys, classifyPointer, inferRootKind, KIND_TO_COMPONENT_SECTION } from "./keywords.ts";

export type { RefAtPosition } from "./refs.ts";
export { findRefAtPosition, parentPointer } from "./refs.ts";

export { relativeRefPath } from "./ref-target-path.ts";

export type { DefinitionParams, DefinitionResult } from "./handlers/definition.ts";
export { getDefinition } from "./handlers/definition.ts";

export type { HoverParams, HoverResult } from "./handlers/hover.ts";
export { getHover } from "./handlers/hover.ts";

export type { CompletionItem, CompletionItemKind, CompletionParams } from "./handlers/completion.ts";
export { getCompletions, keyCompletionsForPointer, refCompletionsForPointer } from "./handlers/completion.ts";

export type { SymbolNodeKind, SymbolResult } from "./handlers/document-symbol.ts";
export { getDocumentSymbols } from "./handlers/document-symbol.ts";

export type { LintDiagnostic } from "@oasis/linter";
export { getDiagnosticsByFile, toLspDiagnostic, toLspRange } from "./diagnostics.ts";
