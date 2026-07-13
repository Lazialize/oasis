import { dirname, resolve as pathResolve } from "node:path";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint, loadConfig, resolveConfig, resolveEntries } from "@oasis/linter";
import type { LintDiagnostic } from "@oasis/linter";
import { hasHelpFlag, parseLintArgs } from "../args.ts";
import { renderJson } from "../render/json.ts";
import { renderPretty } from "../render/pretty.ts";
import { renderSarif } from "../render/sarif.ts";

export interface RunLintOptions {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const LINT_HELP = `oasis lint [entry...] [--config path] [--format pretty|json|sarif]

Lint one or more OpenAPI entry documents. With no entry given, discovers \`oasis.config.jsonc\`
(upward from the working directory, or via --config) and lints every document listed in its
"entries".

Options:
  --config path            Path to an oasis.config.jsonc (skips upward discovery)
  --format pretty|json|sarif  Output format (default: pretty)
  -h, --help                Show this help message
`;

/** Turn a `resolveEntries` "entry not found" warning into a diagnostic attached to the config file. */
function warningDiagnostic(message: string, configPath: string): LintDiagnostic {
  return {
    rule: "oasis/config",
    severity: "warn",
    message,
    range: {
      filePath: configPath,
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
      startOffset: 0,
      endOffset: 0,
    },
  };
}

export async function runLintCommand(args: string[], io: RunLintOptions): Promise<number> {
  if (hasHelpFlag(args)) {
    io.stdout(LINT_HELP);
    return 0;
  }
  const parsed = parseLintArgs(args);
  if (!parsed.ok) {
    io.stderr(`oasis lint: ${parsed.error}\n`);
    return 2;
  }
  const { entries: givenEntries, configPath, format } = parsed.value;

  let loaded: Awaited<ReturnType<typeof loadConfig>>;
  try {
    loaded = await loadConfig({ configPath });
  } catch (err) {
    io.stderr(`oasis lint: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  const resolved = resolveConfig(loaded.configFile);

  /** Print structurally invalid config fields (wrong type for `entries`, `lint.overrides`, ...) to
   * stderr before an early usage-error exit, since those paths never reach diagnostic rendering. */
  function reportConfigDiagnosticsToStderr(): void {
    for (const d of loaded.diagnostics) {
      io.stderr(`${d.range.filePath}:${d.range.start.line + 1}:${d.range.start.character + 1}  ${d.message}\n`);
    }
  }

  let entries: string[];
  const warningDiagnostics: LintDiagnostic[] = [...loaded.diagnostics];

  if (givenEntries.length > 0) {
    entries = givenEntries.map((entry) => pathResolve(process.cwd(), entry));
  } else {
    if (!loaded.path) {
      io.stderr(
        "oasis lint: no entry files given and no oasis.config.jsonc found; " +
          'pass an entry path or add "entries" to a config file\n',
      );
      return 2;
    }
    const configEntries = loaded.configFile.entries ?? [];
    if (configEntries.length === 0) {
      reportConfigDiagnosticsToStderr();
      io.stderr(
        `oasis lint: config "${loaded.path}" has no entries; pass an entry path or add "entries" to the config\n`,
      );
      return 2;
    }
    const resolvedEntries = resolveEntries(loaded.configFile, dirname(loaded.path));
    if (resolvedEntries.entries.length === 0) {
      reportConfigDiagnosticsToStderr();
      for (const warning of resolvedEntries.warnings) io.stderr(`oasis lint: ${warning}\n`);
      return 2;
    }
    entries = resolvedEntries.entries;
    for (const warning of resolvedEntries.warnings) warningDiagnostics.push(warningDiagnostic(warning, loaded.path));
  }

  const fs = new NodeFileSystem();
  const diagnostics: LintDiagnostic[] = [...warningDiagnostics];

  for (const entry of entries) {
    const graph = await loadWorkspaceGraph(fs, entry);
    diagnostics.push(...lint(graph, resolved, { configPath: loaded.path }));
  }

  const rendered =
    format === "json" ? renderJson(diagnostics) : format === "sarif" ? renderSarif(diagnostics) : renderPretty(diagnostics);
  io.stdout(rendered);
  io.stdout("\n");

  return diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}
