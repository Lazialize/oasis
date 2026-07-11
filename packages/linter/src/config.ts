import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve as pathResolve } from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { rules } from "./rules/index.ts";
import type { RuleSeverity } from "./types.ts";

export const CONFIG_FILE_NAME = "oasis.config.jsonc";

export interface LintConfigFile {
  lint?: {
    rules?: Record<string, RuleSeverity>;
  };
}

export interface LoadConfigOptions {
  /** Explicit config file path; when given, upward discovery is skipped. */
  configPath?: string;
  /** Directory to start upward discovery from. Defaults to `process.cwd()`. */
  cwd?: string;
}

export interface LoadedConfig {
  configFile: LintConfigFile;
  /** Absolute path of the config file that was loaded, or undefined if none was found. */
  path: string | undefined;
}

/** Walk upward from `startDir` looking for `oasis.config.jsonc`. */
export function findConfigUpward(startDir: string): string | undefined {
  let dir = pathResolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Load `oasis.config.jsonc`, either from an explicit path or by discovering it upward from `cwd`.
 * Returns an empty config (no error) when no config file is found. Throws if an explicit or
 * discovered config file exists but fails to parse.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const path = options.configPath
    ? pathResolve(options.configPath)
    : findConfigUpward(options.cwd ?? process.cwd());

  if (!path) return { configFile: {}, path: undefined };

  const text = await readFile(path, "utf-8");
  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false }) as
    | LintConfigFile
    | undefined;

  if (errors.length > 0) {
    throw new Error(`Failed to parse config file "${path}": invalid JSONC (error code ${errors[0]?.error})`);
  }

  return { configFile: parsed ?? {}, path };
}

export interface ResolvedLintConfig {
  /** Effective severity for every known rule (defaults merged with config overrides). */
  rules: Record<string, RuleSeverity>;
  /** Human-readable warnings about the config itself (e.g. unknown rule names), not tied to any rule. */
  configWarnings: string[];
}

/** Merge built-in rule defaults with overrides from a loaded config file. */
export function resolveConfig(configFile: LintConfigFile | undefined): ResolvedLintConfig {
  const resolvedRules: Record<string, RuleSeverity> = {};
  for (const rule of rules) resolvedRules[rule.name] = rule.defaultSeverity;

  const configWarnings: string[] = [];
  const overrides = configFile?.lint?.rules ?? {};
  for (const [name, severity] of Object.entries(overrides)) {
    if (!(name in resolvedRules)) {
      configWarnings.push(`Unknown rule "${name}" in config; ignoring.`);
      continue;
    }
    if (!isRuleSeverity(severity)) {
      configWarnings.push(`Invalid severity "${String(severity)}" for rule "${name}" in config; ignoring.`);
      continue;
    }
    resolvedRules[name] = severity;
  }

  return { rules: resolvedRules, configWarnings };
}

function isRuleSeverity(value: unknown): value is RuleSeverity {
  return value === "error" || value === "warn" || value === "info" || value === "off";
}
