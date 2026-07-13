import type { Node } from "yaml";
import type { OasisDocument, OpenApiVersion, Range, WorkspaceGraph } from "@oasis/core";

/** Severity a rule (or config) may assign. "off" disables the rule entirely. */
export type RuleSeverity = "error" | "warn" | "info" | "off";

/** Severity carried by an emitted diagnostic (never "off"). */
export type LintDiagnosticSeverity = "error" | "warn" | "info";

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
  /**
   * Documents from *other* workspace graphs (sibling project entries) whose `$ref`s should also
   * count as "usage" for whole-workspace rules like `components/no-unused`, without themselves being
   * linted. A component in a file shared by two entries and referenced only from the sibling entry
   * would otherwise be reported unused when linting this graph. Populated only by the server's
   * project-mode lint path; absent/empty for a CLI lint (a single entry graph is whole-world by
   * definition). Rules that don't do whole-workspace usage analysis ignore this.
   */
  externalDocuments?: OasisDocument[];
  /** OpenAPI version detected on the entry document, if any. */
  version: OpenApiVersion | undefined;
  /**
   * This rule's resolved options (from the config's top-level `lint.rules` entry, or the rule's
   * own `defaultOptions` if none were given). Rules that don't declare options can ignore this.
   */
  options: unknown;
  /**
   * This rule's resolved options for `filePath`, i.e. `options` with any matching `lint.overrides`
   * applied (later overrides win, same resolution `report()` uses for severity). Rules whose
   * behavior can vary per matched file (e.g. `style/naming-convention`) should call this per
   * reported entity instead of reading the top-level `options`; rules that don't take options, or
   * that don't need per-file granularity, can ignore it.
   */
  optionsFor(filePath: string): unknown;
  /** Record a lint diagnostic at the given location. */
  report(location: ReportLocation, message: string, opts?: ReportOptions): void;
}

export interface Rule {
  name: string;
  /** One-line description of what the rule checks, used in the rule registry / docs. */
  description: string;
  defaultSeverity: RuleSeverity;
  /** Options used when a rule is enabled without an explicit options object. */
  defaultOptions?: unknown;
  /**
   * Validate an options object supplied via the array config form (`["error", { ... }]`).
   * Return an error message describing the problem, or `undefined` if the options are valid.
   * Rules that don't declare this accept any options object without validation.
   */
  validateOptions?(options: unknown): string | undefined;
  check(ctx: RuleContext): void;
}
