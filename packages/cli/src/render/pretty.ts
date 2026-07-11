import type { LintDiagnostic, LintDiagnosticSeverity } from "@oasis/linter";
import { summarize } from "./json.ts";

const COLORS = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
} as const;

function colorsEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return process.stdout.isTTY === true;
}

function colorize(text: string, color: keyof typeof COLORS, enabled: boolean): string {
  if (!enabled) return text;
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function severityLabel(severity: LintDiagnosticSeverity, enabled: boolean): string {
  if (severity === "error") return colorize("error", "red", enabled);
  if (severity === "warning") return colorize("warning", "yellow", enabled);
  return colorize("info", "cyan", enabled);
}

/** Render lint diagnostics grouped by file, `line:col message rule-name`, with a summary line. */
export function renderPretty(diagnostics: LintDiagnostic[]): string {
  const enabled = colorsEnabled();
  const lines: string[] = [];

  if (diagnostics.length === 0) {
    lines.push(colorize("No lint issues found.", "cyan", enabled));
    return lines.join("\n");
  }

  const byFile = new Map<string, LintDiagnostic[]>();
  for (const d of diagnostics) {
    const list = byFile.get(d.range.filePath) ?? [];
    list.push(d);
    byFile.set(d.range.filePath, list);
  }

  for (const [file, fileDiagnostics] of byFile) {
    lines.push(colorize(file, "bold", enabled));
    for (const d of fileDiagnostics) {
      const location = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
      lines.push(`  ${colorize(location, "gray", enabled)}  ${severityLabel(d.severity, enabled)}  ${d.message}  ${colorize(d.rule, "gray", enabled)}`);
    }
    lines.push("");
  }

  const { errors, warnings } = summarize(diagnostics);
  lines.push(`${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`);

  return lines.join("\n");
}
