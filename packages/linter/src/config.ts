import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative as pathRelative, resolve as pathResolve } from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { rules } from "./rules/index.ts";
import type { Rule, RuleSeverity } from "./types.ts";

export const CONFIG_FILE_NAME = "oasis.config.jsonc";

/** A rule's config value: a plain severity, or `[severity, options]` for rules that take options. */
export type RuleConfigValue = RuleSeverity | [RuleSeverity, Record<string, unknown>];

export interface LintOverride {
  /** Globs matched against the diagnostic's file path, relative to the config file's directory. */
  files: string[];
  rules: Record<string, RuleConfigValue>;
}

export interface LintConfigFile {
  lint?: {
    rules?: Record<string, RuleConfigValue>;
    /** Per-glob rule overrides, applied in order (later entries win) on top of `lint.rules`. */
    overrides?: LintOverride[];
  };
  /**
   * Project entry documents, as paths relative to the directory containing this config file.
   * When present, LSP "project mode" builds a workspace graph per entry at startup and publishes
   * diagnostics for every file in those graphs without requiring anything to be open. Absent ->
   * no project mode; behavior is unchanged from entry-per-open-document.
   */
  entries?: string[];
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

/** A rule's resolved severity and options, ready to hand to the engine / rule context. */
export interface ResolvedRuleConfig {
  severity: RuleSeverity;
  options: unknown;
}

/** A `lint.overrides` entry after validation: globs plus the rule config values that apply when they match. */
export interface ResolvedOverride {
  files: string[];
  rules: Record<string, ResolvedRuleConfig>;
}

export interface ResolvedLintConfig {
  /** Effective top-level severity/options for every known rule (defaults merged with config overrides). */
  rules: Record<string, ResolvedRuleConfig>;
  /** Validated per-glob overrides, in declaration order. */
  overrides: ResolvedOverride[];
  /** Human-readable warnings about the config itself (e.g. unknown rule names), not tied to any rule. */
  configWarnings: string[];
}

/**
 * Parse and validate a single rule config value (plain severity or `[severity, options]`) against
 * the given rule registry. Returns `undefined` and pushes a warning for anything invalid: unknown
 * rule name, malformed severity/array shape, or options that fail the rule's own `validateOptions`.
 */
function resolveRuleConfigValue(
  ruleName: string,
  value: unknown,
  ruleByName: Map<string, Rule>,
  configWarnings: string[],
): ResolvedRuleConfig | undefined {
  const rule = ruleByName.get(ruleName);
  if (!rule) {
    configWarnings.push(`Unknown rule "${ruleName}" in config; ignoring.`);
    return undefined;
  }

  let severity: RuleSeverity;
  let options: unknown;
  if (Array.isArray(value)) {
    const [sev, opts] = value;
    if (value.length !== 2 || !isRuleSeverity(sev) || typeof opts !== "object" || opts === null || Array.isArray(opts)) {
      configWarnings.push(`Invalid rule config for "${ruleName}" in config; expected ["severity", { ...options }]; ignoring.`);
      return undefined;
    }
    severity = sev;
    options = opts;
  } else if (isRuleSeverity(value)) {
    severity = value;
    options = undefined;
  } else {
    configWarnings.push(`Invalid severity "${String(value)}" for rule "${ruleName}" in config; ignoring.`);
    return undefined;
  }

  if (options !== undefined && rule.validateOptions) {
    const error = rule.validateOptions(options);
    if (error) {
      configWarnings.push(`Invalid options for rule "${ruleName}" in config: ${error}; ignoring.`);
      return undefined;
    }
  }

  return { severity, options: options ?? rule.defaultOptions };
}

/**
 * Merge built-in rule defaults with overrides from a loaded config file. `ruleList` defaults to
 * the built-in rule registry; tests may pass a custom list to exercise config validation against
 * a fake rule without registering it for real.
 */
export function resolveConfig(configFile: LintConfigFile | undefined, ruleList: Rule[] = rules): ResolvedLintConfig {
  const configWarnings: string[] = [];
  const ruleByName = new Map<string, Rule>(ruleList.map((rule) => [rule.name, rule]));

  const resolvedRules: Record<string, ResolvedRuleConfig> = {};
  for (const rule of ruleList) resolvedRules[rule.name] = { severity: rule.defaultSeverity, options: rule.defaultOptions };

  for (const [name, value] of Object.entries(configFile?.lint?.rules ?? {})) {
    const resolved = resolveRuleConfigValue(name, value, ruleByName, configWarnings);
    if (resolved) resolvedRules[name] = resolved;
  }

  const overrides: ResolvedOverride[] = [];
  for (const [i, override] of (configFile?.lint?.overrides ?? []).entries()) {
    if (!Array.isArray(override?.files) || !override.files.every((f) => typeof f === "string")) {
      configWarnings.push(`Invalid "files" in lint.overrides[${i}] in config; expected an array of glob strings; ignoring override.`);
      continue;
    }
    const overrideRules: Record<string, ResolvedRuleConfig> = {};
    for (const [name, value] of Object.entries(override.rules ?? {})) {
      const resolved = resolveRuleConfigValue(name, value, ruleByName, configWarnings);
      if (resolved) overrideRules[name] = resolved;
    }
    overrides.push({ files: override.files, rules: overrideRules });
  }

  return { rules: resolvedRules, overrides, configWarnings };
}

function isRuleSeverity(value: unknown): value is RuleSeverity {
  return value === "error" || value === "warn" || value === "info" || value === "off";
}

/**
 * Resolve the effective severity/options for `ruleName` at `filePath`: start from the top-level
 * `lint.rules` entry, then apply matching `lint.overrides` in declaration order (later wins).
 * `configDir` is the directory containing the config file; overrides are skipped entirely when
 * it's undefined (no config file was loaded, so there's nothing to resolve globs against).
 */
export function effectiveRuleConfig(
  config: ResolvedLintConfig,
  ruleName: string,
  filePath: string,
  configDir: string | undefined,
): ResolvedRuleConfig {
  let effective = config.rules[ruleName] ?? { severity: "off" as RuleSeverity, options: undefined };
  if (!configDir) return effective;

  const relativePath = pathRelative(configDir, filePath);
  for (const override of config.overrides) {
    const overrideRule = override.rules[ruleName];
    if (!overrideRule) continue;
    if (override.files.some((pattern) => new Bun.Glob(pattern).match(relativePath))) {
      effective = overrideRule;
    }
  }
  return effective;
}

export interface ResolvedEntries {
  /** Absolute paths of entries that exist on disk, in the order declared in the config. */
  entries: string[];
  /** Warnings for entries that were declared but could not be found. */
  warnings: string[];
}

/**
 * Resolve `configFile.entries` (paths relative to `configDir`, the directory containing the
 * config file) into absolute paths. Missing files produce a warning rather than throwing; an
 * absent/empty `entries` field resolves to an empty list with no warnings.
 */
export function resolveEntries(configFile: LintConfigFile | undefined, configDir: string): ResolvedEntries {
  const entries: string[] = [];
  const warnings: string[] = [];
  for (const raw of configFile?.entries ?? []) {
    const abs = pathResolve(configDir, raw);
    if (!existsSync(abs)) {
      warnings.push(`Entry "${raw}" in config not found (resolved to "${abs}"); skipping.`);
      continue;
    }
    entries.push(abs);
  }
  return { entries, warnings };
}
