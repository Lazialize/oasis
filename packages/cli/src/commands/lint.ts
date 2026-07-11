import { resolve as pathResolve } from "node:path";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint, loadConfig, resolveConfig } from "@oasis/linter";
import type { LintDiagnostic } from "@oasis/linter";
import { parseLintArgs } from "../args.ts";
import { renderJson } from "../render/json.ts";
import { renderPretty } from "../render/pretty.ts";

export interface RunLintOptions {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export async function runLintCommand(args: string[], io: RunLintOptions): Promise<number> {
  const parsed = parseLintArgs(args);
  if (!parsed.ok) {
    io.stderr(`oasis lint: ${parsed.error}\n`);
    return 2;
  }
  const { entries, configPath, format } = parsed.value;

  let loaded: Awaited<ReturnType<typeof loadConfig>>;
  try {
    loaded = await loadConfig({ configPath });
  } catch (err) {
    io.stderr(`oasis lint: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  const resolved = resolveConfig(loaded.configFile);

  const fs = new NodeFileSystem();
  const diagnostics: LintDiagnostic[] = [];

  for (const entry of entries) {
    const absEntry = pathResolve(process.cwd(), entry);
    const graph = await loadWorkspaceGraph(fs, absEntry);
    diagnostics.push(...lint(graph, resolved, { configPath: loaded.path }));
  }

  io.stdout(format === "json" ? renderJson(diagnostics) : renderPretty(diagnostics));
  io.stdout("\n");

  return diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}
