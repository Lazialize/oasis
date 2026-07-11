import type { Node } from "yaml";
import type { OasisDocument, OpenApiVersion, Range, WorkspaceGraph } from "@oasis/core";

/** Severity a rule (or config) may assign. "off" disables the rule entirely. */
export type RuleSeverity = "error" | "warn" | "info" | "off";

/** Severity carried by an emitted diagnostic (never "off"). */
export type LintDiagnosticSeverity = "error" | "warning" | "info";

export interface LintDiagnostic {
  rule: string;
  severity: LintDiagnosticSeverity;
  message: string;
  range: Range;
}

/** A location to attach a diagnostic to: a concrete range, a pointer into a document, or an AST node within a document. */
export type ReportLocation = Range | { doc: OasisDocument; pointer: string } | { doc: OasisDocument; node: Node };

export interface ReportOptions {
  /** Override the severity this particular report is emitted at (rare; defaults to the rule's resolved severity). */
  severity?: RuleSeverity;
}

export interface RuleContext {
  graph: WorkspaceGraph;
  /** The entry document of the workspace graph. */
  entryDoc: OasisDocument;
  /** All documents loaded into the workspace graph, entry document first. */
  documents: OasisDocument[];
  /** OpenAPI version detected on the entry document, if any. */
  version: OpenApiVersion | undefined;
  /** Record a lint diagnostic at the given location. */
  report(location: ReportLocation, message: string, opts?: ReportOptions): void;
}

export interface Rule {
  name: string;
  /** One-line description of what the rule checks, used in the rule registry / docs. */
  description: string;
  defaultSeverity: RuleSeverity;
  check(ctx: RuleContext): void;
}
