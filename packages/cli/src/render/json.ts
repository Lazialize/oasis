import type { LintDiagnostic } from "@oasis/linter";

export interface JsonDiagnostic {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  file: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface JsonReport {
  diagnostics: JsonDiagnostic[];
  summary: { errors: number; warnings: number; infos: number };
}

export function toJsonReport(diagnostics: LintDiagnostic[]): JsonReport {
  const jsonDiagnostics: JsonDiagnostic[] = diagnostics.map((d) => ({
    rule: d.rule,
    severity: d.severity,
    message: d.message,
    file: d.range.filePath,
    range: { start: d.range.start, end: d.range.end },
  }));

  return { diagnostics: jsonDiagnostics, summary: summarize(diagnostics) };
}

export function summarize(diagnostics: LintDiagnostic[]): { errors: number; warnings: number; infos: number } {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const d of diagnostics) {
    if (d.severity === "error") errors++;
    else if (d.severity === "warning") warnings++;
    else infos++;
  }
  return { errors, warnings, infos };
}

export function renderJson(diagnostics: LintDiagnostic[]): string {
  return JSON.stringify(toJsonReport(diagnostics), null, 2);
}
