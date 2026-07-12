import { lint, resolveConfig } from "@oasis/linter";
import type { LintConfigFile, LintDiagnostic, LintDiagnosticSeverity } from "@oasis/linter";
import type { Range } from "@oasis/core";
import { DiagnosticSeverity } from "vscode-languageserver";
import type { Diagnostic as LspDiagnostic } from "vscode-languageserver";
import { findNearestConfigFile } from "./project.ts";
import { findProjectForEntry, getGraph } from "./workspace.ts";
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
 * Resolve the `lint.rules`/`lint.overrides` config that applies to `entryPath`: the config of the
 * project it belongs to (already loaded, overlay-aware — see `findProjectForEntry`) if it's a
 * project entry, otherwise the nearest `oasis.config.jsonc` found by walking upward through
 * `ctx.fileSystem` (so unsaved edits to the config file itself are honored either way, without
 * requiring a save or a second, disk-only config read).
 */
async function loadEffectiveConfig(
  ctx: ServerContext,
  entryPath: string,
): Promise<{ configFile: LintConfigFile; configPath: string | undefined }> {
  const project = findProjectForEntry(ctx, entryPath);
  if (project) return { configFile: project.configFile, configPath: project.configPath };

  const nearest = await findNearestConfigFile(ctx, entryPath);
  return { configFile: nearest?.configFile ?? {}, configPath: nearest?.configPath };
}

/**
 * Lint the workspace graph rooted at `entryPath` and group the resulting diagnostics by file, so
 * the caller can `publishDiagnostics` per-file (including files referenced by, but not the same
 * as, the open entry document).
 */
export async function getDiagnosticsByFile(ctx: ServerContext, entryPath: string): Promise<Map<string, LspDiagnostic[]>> {
  const graph = await getGraph(ctx, entryPath);

  const loaded = await loadEffectiveConfig(ctx, entryPath);
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
