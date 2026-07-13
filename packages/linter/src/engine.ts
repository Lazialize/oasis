import { dirname } from "node:path";
import type { Node } from "yaml";
import { detectVersion, extractSuppressions, isSuppressed, nodeAtPointer, rangeFromOffsets, zeroRange } from "@oasis/core";
import type { FileSuppressions, OasisDocument, Range, WorkspaceGraph } from "@oasis/core";
import { rules } from "./rules/index.ts";
import type { LintDiagnostic, LintDiagnosticSeverity, ReportLocation, Rule, RuleContext, RuleSeverity } from "./types.ts";
import { effectiveRuleConfig } from "./config.ts";
import type { ResolvedLintConfig } from "./config.ts";

export interface LintOptions {
  /** Path to the config file actually used, for diagnostics that reference config problems. */
  configPath?: string;
  /**
   * Documents from sibling workspace graphs whose `$ref`s should count toward usage for
   * whole-workspace rules (see `RuleContext.externalDocuments`). Passed through unchanged to every
   * rule's context. Omitted by the CLI; supplied only by the server's project-mode lint path.
   */
  externalDocuments?: OasisDocument[];
}

/** Map a rule/config severity to the severity carried on emitted diagnostics. Callers must have already excluded "off". */
function toDiagnosticSeverity(severity: Exclude<RuleSeverity, "off">): LintDiagnosticSeverity {
  return severity;
}

function resolveLocation(location: ReportLocation): Range | undefined {
  if ("filePath" in location) return location;
  if ("pointer" in location) {
    return nodeAtPointer(location.doc, location.pointer)?.range ?? zeroRange(location.doc.filePath);
  }
  const node: Node = location.node;
  if (!node.range) return zeroRange(location.doc.filePath);
  return rangeFromOffsets(location.doc.filePath, location.doc.lineCounter, node.range[0], node.range[1]);
}

/**
 * Run the lint rule engine over a workspace graph. Core parse/graph diagnostics (syntax errors,
 * duplicate keys, unresolved refs, ref cycles) flow through the same pipeline as built-in rules:
 * syntax errors are always emitted as errors and cannot be disabled; the rest are surfaced by the
 * `syntax/no-duplicate-keys` / `refs/no-unresolved` / `refs/no-cycle` rules and are subject to config.
 */
export function lint(
  graph: WorkspaceGraph,
  config: ResolvedLintConfig,
  options: LintOptions = {},
  ruleList: Rule[] = rules as Rule[],
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const entryDoc = graph.documents.get(graph.entryPath);
  const documents = [...graph.documents.values()];
  if (entryDoc) {
    const idx = documents.indexOf(entryDoc);
    if (idx > 0) {
      documents.splice(idx, 1);
      documents.unshift(entryDoc);
    }
  }

  // Syntax errors: always errors, never disableable, not part of the rule registry.
  for (const doc of documents) {
    for (const d of doc.diagnostics) {
      if (d.source === "yaml" && d.severity === "error") {
        diagnostics.push({ rule: "syntax-error", severity: "error", message: d.message, range: d.range });
      }
    }
  }

  // Unknown rule names in config surface as warnings, not crashes.
  for (const warning of config.configWarnings) {
    diagnostics.push({
      rule: "oasis/config",
      severity: "warn",
      message: warning,
      range: zeroRange(options.configPath ?? graph.entryPath),
    });
  }

  const configDir = options.configPath ? dirname(options.configPath) : undefined;

  if (!entryDoc) {
    // The entry itself failed to load (e.g. the file doesn't exist). No document ever gets a
    // chance to $ref it, so `refs/no-unresolved` never runs to surface `graph.diagnostics` for
    // it the way it does for referenced-but-missing files. Fold it in here instead, once, so
    // `lint` never silently reports zero diagnostics for a broken entry path.
    for (const d of graph.diagnostics) {
      if (d.code !== "no-unresolved-ref") continue;
      const effective = effectiveRuleConfig(config, "refs/no-unresolved", d.range.filePath, configDir);
      if (effective.severity === "off") continue;
      diagnostics.push({ rule: "refs/no-unresolved", severity: toDiagnosticSeverity(effective.severity), message: d.message, range: d.range });
    }
    return sortDiagnostics(diagnostics);
  }

  // Inline `# oasis-disable-*` comment directives, per file. Syntax-error diagnostics above are
  // pushed directly (not through `report()`) and are therefore never subject to suppression.
  const suppressionsByFile = new Map<string, FileSuppressions>();
  for (const doc of documents) suppressionsByFile.set(doc.filePath, extractSuppressions(doc.text));

  for (const rule of ruleList) {
    const base = config.rules[rule.name] ?? { severity: rule.defaultSeverity, options: rule.defaultOptions };
    // An override can enable a globally-off rule (or vice versa) for specific files, so only skip
    // running the rule entirely when nothing could possibly turn it on for any file.
    const hasOverrideForRule = config.overrides.some((o) => rule.name in o.rules);
    if (base.severity === "off" && !hasOverrideForRule) continue;

    const ctx: RuleContext = {
      graph,
      entryDoc,
      documents,
      externalDocuments: options.externalDocuments,
      version: detectVersion(entryDoc),
      options: base.options,
      optionsFor(filePath) {
        return effectiveRuleConfig(config, rule.name, filePath, configDir).options;
      },
      report(location, message, opts) {
        const range = resolveLocation(location);
        if (!range) return;
        const effective = effectiveRuleConfig(config, rule.name, range.filePath, configDir);
        if (effective.severity === "off") return;
        const effectiveSeverity = opts?.severity ?? effective.severity;
        if (effectiveSeverity === "off") return;
        const suppressions = suppressionsByFile.get(range.filePath);
        if (suppressions && isSuppressed(suppressions, rule.name, range.start.line)) return;
        diagnostics.push({ rule: rule.name, severity: toDiagnosticSeverity(effectiveSeverity), message, range });
      },
    };

    rule.check(ctx);
  }

  return sortDiagnostics(diagnostics);
}

function sortDiagnostics(diagnostics: LintDiagnostic[]): LintDiagnostic[] {
  return [...diagnostics].sort((a, b) => {
    if (a.range.filePath !== b.range.filePath) return a.range.filePath < b.range.filePath ? -1 : 1;
    if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
    if (a.range.start.character !== b.range.start.character) return a.range.start.character - b.range.start.character;
    return a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0;
  });
}
