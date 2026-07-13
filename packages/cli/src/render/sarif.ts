import { pathToFileURL } from "node:url";
import type { LintDiagnostic, LintDiagnosticSeverity } from "@oasis/linter";
import packageJson from "../../package.json" with { type: "json" };
import { toRelativeFilePath } from "./paths.ts";

const SARIF_INFORMATION_URI = "https://github.com/Lazialize/oasis";

interface SarifRegion {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: SarifRegion;
    };
  }>;
}

interface SarifReportingDescriptor {
  id: string;
  shortDescription: { text: string };
}

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: Array<{
    tool: {
      driver: {
        name: string;
        informationUri: string;
        version: string;
        rules: SarifReportingDescriptor[];
      };
    };
    results: SarifResult[];
  }>;
}

/** Map a lint diagnostic severity to a SARIF result level. SARIF's "warning" token is fixed by the
 * spec and is unrelated to our own "warn" severity token. */
function toSarifLevel(severity: LintDiagnosticSeverity): "error" | "warning" | "note" {
  if (severity === "error") return "error";
  if (severity === "warn") return "warning";
  return "note";
}

/**
 * A repo-relative, forward-slashed URI for `filePath` when it lives under `cwd`; otherwise an
 * absolute `file://` URI built with `pathToFileURL` so spaces, `#`, `%`, non-ASCII characters, and
 * platform path syntax (e.g. Windows drive letters/backslashes) are correctly percent-encoded.
 * GitHub code scanning requires artifact locations relative to the repository root, but
 * diagnostics can point outside `cwd` (e.g. a `$ref`'d file elsewhere).
 */
function toArtifactUri(filePath: string, cwd: string): string {
  const rel = toRelativeFilePath(filePath, cwd);
  return rel === filePath ? pathToFileURL(filePath).href : rel;
}

/** Internal ranges are 0-based (line and character); SARIF regions are 1-based. */
function toSarifRegion(diagnostic: LintDiagnostic): SarifRegion {
  return {
    startLine: diagnostic.range.start.line + 1,
    startColumn: diagnostic.range.start.character + 1,
    endLine: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.character + 1,
  };
}

/** Build a single-run SARIF 2.1.0 log for a combined set of diagnostics from one or more entries. */
export function toSarifLog(diagnostics: LintDiagnostic[], cwd: string = process.cwd()): SarifLog {
  const ruleIds = new Set<string>();
  const results: SarifResult[] = [];

  for (const d of diagnostics) {
    ruleIds.add(d.rule);
    results.push({
      ruleId: d.rule,
      level: toSarifLevel(d.severity),
      message: { text: d.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: toArtifactUri(d.range.filePath, cwd) },
            region: toSarifRegion(d),
          },
        },
      ],
    });
  }

  const rules: SarifReportingDescriptor[] = [...ruleIds].sort().map((id) => ({
    id,
    shortDescription: { text: id },
  }));

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "oasis",
            informationUri: SARIF_INFORMATION_URI,
            version: packageJson.version,
            rules,
          },
        },
        results,
      },
    ],
  };
}

export function renderSarif(diagnostics: LintDiagnostic[], cwd: string = process.cwd()): string {
  return JSON.stringify(toSarifLog(diagnostics, cwd), null, 2);
}
