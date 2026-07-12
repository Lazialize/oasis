export interface ParsedLintArgs {
  entries: string[];
  configPath?: string;
  format: "pretty" | "json" | "sarif";
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Parse arguments for `oasis lint [entry...] [--config path] [--format pretty|json|sarif]`.
 * Entries are optional: with none given, the caller falls back to `entries` declared in a
 * discovered `oasis.config.jsonc` (see `runLintCommand`).
 */
export function parseLintArgs(args: string[]): ParseResult<ParsedLintArgs> {
  const entries: string[] = [];
  let configPath: string | undefined;
  let format: "pretty" | "json" | "sarif" = "pretty";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config") {
      const value = args[++i];
      if (!value) return { ok: false, error: "--config requires a path argument" };
      configPath = value;
    } else if (arg === "--format") {
      const value = args[++i];
      if (value !== "pretty" && value !== "json" && value !== "sarif") {
        return { ok: false, error: '--format must be "pretty", "json", or "sarif"' };
      }
      format = value;
    } else if (arg?.startsWith("--")) {
      return { ok: false, error: `Unknown flag "${arg}"` };
    } else if (arg) {
      entries.push(arg);
    }
  }

  return { ok: true, value: { entries, configPath, format } };
}

export interface ParsedBundleArgs {
  entry: string;
  outPath?: string;
  /** Explicit `--format`, if given; undefined means "infer from --out extension, default yaml". */
  format?: "yaml" | "json";
}

/** Parse arguments for `oasis bundle <entry> [-o|--out path] [--format yaml|json]`. */
export function parseBundleArgs(args: string[]): ParseResult<ParsedBundleArgs> {
  let entry: string | undefined;
  let outPath: string | undefined;
  let format: "yaml" | "json" | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-o" || arg === "--out") {
      const value = args[++i];
      if (!value) return { ok: false, error: `${arg} requires a path argument` };
      outPath = value;
    } else if (arg === "--format") {
      const value = args[++i];
      if (value !== "yaml" && value !== "json") {
        return { ok: false, error: '--format must be "yaml" or "json"' };
      }
      format = value;
    } else if (arg?.startsWith("-")) {
      return { ok: false, error: `Unknown flag "${arg}"` };
    } else if (arg && !entry) {
      entry = arg;
    } else if (arg) {
      return { ok: false, error: `Unexpected argument "${arg}"` };
    }
  }

  if (!entry) {
    return { ok: false, error: "An entry file is required" };
  }

  return { ok: true, value: { entry, outPath, format } };
}
