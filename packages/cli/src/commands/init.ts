import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative as pathRelative, resolve as pathResolve } from "node:path";
import { CONFIG_FILE_NAME } from "@oasis/linter";
import { looksLikeOpenApi } from "@oasis/server";

export interface RunInitOptions {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const ENTRY_SCAN_MAX_DEPTH = 2;

/**
 * Scan `dir` (up to `ENTRY_SCAN_MAX_DEPTH` levels deep, skipping node_modules and hidden
 * directories) for YAML/JSON files whose root has an `openapi:` key. Returns paths relative
 * to `dir`, sorted.
 *
 * Detection reuses `looksLikeOpenApi` from `@oasis/server` (the same root-aware, nesting-aware
 * guard the LSP uses to decide whether an opened document is an OpenAPI entry) rather than a
 * separate ad-hoc regex/JSON.parse check, so all three consumers (CLI init, LSP, VS Code
 * extension) agree on what counts as an OpenAPI root document (issue #80).
 */
export async function detectEntryDocuments(dir: string): Promise<string[]> {
  const found: string[] = [];

  async function scan(current: string, depth: number): Promise<void> {
    let names: { name: string; isDirectory(): boolean; isFile(): boolean }[];
    try {
      names = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      if (entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        if (depth < ENTRY_SCAN_MAX_DEPTH) await scan(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.(ya?ml|json)$/i.test(entry.name)) continue;
      try {
        const text = await readFile(full, "utf-8");
        if (looksLikeOpenApi(text)) found.push(pathRelative(dir, full));
      } catch {
        // Unreadable file: skip.
      }
    }
  }

  await scan(dir, 1);
  return found.sort();
}

function renderConfig(entries: string[]): string {
  const entriesLines =
    entries.length > 0
      ? `  "entries": [${entries.map((e) => JSON.stringify(e)).join(", ")}],`
      : `  // "entries": ["openapi.yaml"],`;

  return `{
  // Oasis configuration. See the README "Configuration" section for the full format.

  // Entry documents, relative to this file. Used by \`oasis lint\` (with no arguments)
  // and by the LSP's project mode. Glob patterns like "apis/**/openapi.yaml" also work.
${entriesLines}

  "lint": {
    "rules": {
      // Override built-in rule severities ("error" | "warn" | "info" | "off") or pass
      // options; see the README "Built-in rules" table for the full list. For example:
      // "operation/tags": "off",
      // "style/naming-convention": ["warn", { "operationId": "camelCase" }],
    },
  },
}
`;
}

const INIT_HELP = `oasis init

Scaffold an oasis.config.jsonc file in the current working directory.
Automatically detects OpenAPI entry documents up to 2 levels deep.

Options:
  -h, --help             Show this help message
`;

/** `oasis init`: scaffold an `oasis.config.jsonc` in the current working directory. */
export async function runInitCommand(args: string[], io: RunInitOptions): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    io.stdout(INIT_HELP);
    return 0;
  }
  if (args.length > 0) {
    io.stderr(`oasis init: unexpected argument "${args[0]}" (init takes no arguments)\n`);
    return 2;
  }

  const cwd = process.cwd();
  const configPath = pathResolve(cwd, CONFIG_FILE_NAME);
  if (existsSync(configPath)) {
    io.stderr(`oasis init: ${CONFIG_FILE_NAME} already exists in this directory ("${configPath}"); not overwriting\n`);
    return 2;
  }

  const entries = await detectEntryDocuments(cwd);

  try {
    await writeFile(configPath, renderConfig(entries), { flag: "wx" });
  } catch (err) {
    io.stderr(`oasis init: failed to write ${CONFIG_FILE_NAME}: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  io.stdout(`Created ${CONFIG_FILE_NAME}\n`);
  if (entries.length > 0) {
    io.stdout(`Detected ${entries.length} OpenAPI ${entries.length === 1 ? "document" : "documents"}:\n`);
    for (const entry of entries) io.stdout(`  ${entry}\n`);
  } else {
    io.stdout(`No OpenAPI documents found nearby; add your entry documents to "entries" by hand.\n`);
  }
  return 0;
}
