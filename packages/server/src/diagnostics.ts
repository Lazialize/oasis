import { dirname } from "node:path";
import { lint, loadConfig, resolveConfig } from "@oasis/linter";
import type { LintDiagnostic, LintDiagnosticSeverity } from "@oasis/linter";
import type { Range } from "@oasis/core";
import { DiagnosticSeverity } from "vscode-languageserver";
import type { Diagnostic as LspDiagnostic } from "vscode-languageserver";
import { getGraph } from "./workspace.ts";
import type { ServerContext } from "./workspace.ts";

const SEVERITY_MAP: Record<LintDiagnosticSeverity, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
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
 */
export async function getDiagnosticsByFile(ctx: ServerContext, entryPath: string): Promise<Map<string, LspDiagnostic[]>> {
  const graph = await getGraph(ctx, entryPath);

  let loaded: Awaited<ReturnType<typeof loadConfig>>;
  try {
    loaded = await loadConfig({ cwd: dirname(entryPath) });
  } catch {
    loaded = { configFile: {}, path: undefined };
  }
  const resolved = resolveConfig(loaded.configFile);

  const diagnostics = lint(graph, resolved, { configPath: loaded.path });

  const byFile = new Map<string, LspDiagnostic[]>();
  for (const path of graph.documents.keys()) byFile.set(path, []);
  for (const d of diagnostics) {
    const list = byFile.get(d.range.filePath) ?? [];
    list.push(toLspDiagnostic(d));
    byFile.set(d.range.filePath, list);
  }
  return byFile;
}
