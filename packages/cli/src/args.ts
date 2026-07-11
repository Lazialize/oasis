export interface ParsedLintArgs {
  entries: string[];
  configPath?: string;
  format: "pretty" | "json";
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parse arguments for `oasis lint <entry...> [--config path] [--format pretty|json]`. */
export function parseLintArgs(args: string[]): ParseResult<ParsedLintArgs> {
  const entries: string[] = [];
  let configPath: string | undefined;
  let format: "pretty" | "json" = "pretty";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config") {
      const value = args[++i];
      if (!value) return { ok: false, error: "--config requires a path argument" };
      configPath = value;
    } else if (arg === "--format") {
      const value = args[++i];
      if (value !== "pretty" && value !== "json") {
        return { ok: false, error: '--format must be "pretty" or "json"' };
      }
      format = value;
    } else if (arg?.startsWith("--")) {
      return { ok: false, error: `Unknown flag "${arg}"` };
    } else if (arg) {
      entries.push(arg);
    }
  }

  if (entries.length === 0) {
    return { ok: false, error: "At least one entry file is required" };
  }

  return { ok: true, value: { entries, configPath, format } };
}
