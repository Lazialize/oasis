import { lint, resolveConfig } from "@oasis/linter";
import type { LintDiagnostic, LintDiagnosticSeverity } from "@oasis/linter";
import type { Range } from "@oasis/core";
import { DiagnosticSeverity } from "vscode-languageserver";
import type { Diagnostic as LspDiagnostic } from "vscode-languageserver";
import { resolveConfigForEntry } from "./project.ts";
import { getGraph } from "./workspace.ts";
import type { ServerContext } from "./workspace.ts";

const SEVERITY_MAP: Record<LintDiagnosticSeverity, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warn: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
};

export function toLspDiagnostic(d: LintDiagnostic): LspDiagnostic {
  return {
    message: d.message,
    severity: SEVERITY_MAP[d.severity],
    source: "oasis",
    code: d.rule,
    range: toLspRange(d.range),
  };
}

export function toLspRange(range: Range): { start: { line: number; character: number }; end: { line: number; character: number } } {
  return { start: range.start, end: range.end };
}

/**
 * Lint the workspace graph rooted at `entryPath` and group the resulting diagnostics by file, so
 * the caller can `publishDiagnostics` per-file (including files referenced by, but not the same
 * as, the open entry document).
 *
 * The `lint.rules`/`lint.overrides` config that applies is resolved through the single shared
 * `resolveConfigForEntry` (project config if `entryPath` is a project member, otherwise the
 * nearest `oasis.config.jsonc` found upward, cached — see `project.ts`), so this always agrees
 * with `connection.ts`'s config-warning publishing about which config governs a given entry.
 */
export async function getDiagnosticsByFile(ctx: ServerContext, entryPath: string): Promise<Map<string, LspDiagnostic[]>> {
  const graph = await getGraph(ctx, entryPath);

  const loaded = await resolveConfigForEntry(ctx, entryPath);
  const resolved = resolveConfig(loaded.configFile);

  const diagnostics = lint(graph, resolved, { configPath: loaded.configPath });

  const byFile = new Map<string, LspDiagnostic[]>();
  for (const path of graph.documents.keys()) byFile.set(path, []);
  for (const d of diagnostics) {
    const list = byFile.get(d.range.filePath) ?? [];
    list.push(toLspDiagnostic(d));
    byFile.set(d.range.filePath, list);
  }
  return byFile;
}
