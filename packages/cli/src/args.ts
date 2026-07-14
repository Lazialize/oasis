export interface ParsedLintArgs {
  entries: string[];
  configPath?: string;
  format: "pretty" | "json" | "sarif";
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Whether `-h`/`--help` appears among `args` before the first `--` positional-only delimiter.
 * Command entry points should use this instead of a raw `args.includes("--help")` scan, so that
 * `--` correctly protects a positional argument that happens to look like a help flag (e.g. a
 * filename literally named `--help`).
 */
export function hasHelpFlag(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--") return false;
    if (arg === "-h" || arg === "--help") return true;
  }
  return false;
}

/**
 * Consume the value for an option token at `args[i]` matching one of `flagNames` (e.g. `["-o",
 * "--out"]`). Supports both `--flag value` and `--flag=value` forms. In the space-separated form,
 * a next token that matches another recognized flag is rejected as a missing value rather than
 * silently consumed — use `--flag=-value` (the `=` form) to pass a dash-prefixed value explicitly.
 */
function consumeOptionValue(
  args: string[],
  i: number,
  flagNames: readonly string[],
  recognizedFlags: ReadonlySet<string>,
  errorMessage: string,
): ParseResult<{ value: string; nextIndex: number }> {
  const arg = args[i] ?? "";
  for (const flag of flagNames) {
    const eqPrefix = `${flag}=`;
    if (arg.startsWith(eqPrefix)) {
      const value = arg.slice(eqPrefix.length);
      if (!value) {
        return { ok: false, error: errorMessage };
      }
      return { ok: true, value: { value, nextIndex: i } };
    }
  }
  const value = args[i + 1];
  if (!value || recognizedFlags.has(value)) {
    return { ok: false, error: errorMessage };
  }
  return { ok: true, value: { value, nextIndex: i + 1 } };
}

const LINT_FLAGS = new Set(["--config", "--format", "-h", "--help"]);

/**
 * Parse arguments for `oasis lint [entry...] [--config path] [--format pretty|json|sarif]`.
 * Entries are optional: with none given, the caller falls back to `entries` declared in a
 * discovered `oasis.config.jsonc` (see `runLintCommand`).
 */
export function parseLintArgs(args: string[]): ParseResult<ParsedLintArgs> {
  const entries: string[] = [];
  let configPath: string | undefined;
  let format: "pretty" | "json" | "sarif" = "pretty";
  let positionalOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!positionalOnly && arg === "--") {
      positionalOnly = true;
    } else if (!positionalOnly && (arg === "--config" || arg?.startsWith("--config="))) {
      const consumed = consumeOptionValue(args, i, ["--config"], LINT_FLAGS, "--config requires a path argument");
      if (!consumed.ok) return consumed;
      configPath = consumed.value.value;
      i = consumed.value.nextIndex;
    } else if (!positionalOnly && (arg === "--format" || arg?.startsWith("--format="))) {
      const consumed = consumeOptionValue(args, i, ["--format"], LINT_FLAGS, "--format requires a value argument");
      if (!consumed.ok) return consumed;
      const value = consumed.value.value;
      if (value !== "pretty" && value !== "json" && value !== "sarif") {
        return { ok: false, error: '--format must be "pretty", "json", or "sarif"' };
      }
      format = value;
      i = consumed.value.nextIndex;
    } else if (!positionalOnly && arg?.startsWith("-")) {
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
  /** `--dereference`: fully inline every `$ref` instead of lifting external refs into `components/*`. */
  dereference: boolean;
}

const BUNDLE_FLAGS = new Set(["-o", "--out", "--format", "--dereference", "-h", "--help"]);

/** Parse arguments for `oasis bundle <entry> [-o|--out path] [--format yaml|json] [--dereference]`. */
export function parseBundleArgs(args: string[]): ParseResult<ParsedBundleArgs> {
  let entry: string | undefined;
  let outPath: string | undefined;
  let format: "yaml" | "json" | undefined;
  let dereference = false;
  let positionalOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!positionalOnly && arg === "--") {
      positionalOnly = true;
    } else if (
      !positionalOnly &&
      (arg === "-o" || arg === "--out" || arg?.startsWith("-o=") || arg?.startsWith("--out="))
    ) {
      const consumed = consumeOptionValue(args, i, ["-o", "--out"], BUNDLE_FLAGS, `${arg.split("=")[0]} requires a path argument`);
      if (!consumed.ok) return consumed;
      outPath = consumed.value.value;
      i = consumed.value.nextIndex;
    } else if (!positionalOnly && (arg === "--format" || arg?.startsWith("--format="))) {
      const consumed = consumeOptionValue(args, i, ["--format"], BUNDLE_FLAGS, "--format requires a value argument");
      if (!consumed.ok) return consumed;
      const value = consumed.value.value;
      if (value !== "yaml" && value !== "json") {
        return { ok: false, error: '--format must be "yaml" or "json"' };
      }
      format = value;
      i = consumed.value.nextIndex;
    } else if (!positionalOnly && arg === "--dereference") {
      dereference = true;
    } else if (!positionalOnly && arg?.startsWith("-")) {
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

  return { ok: true, value: { entry, outPath, format, dereference } };
}
