import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative as pathRelative, resolve as pathResolve, sep } from "node:path";
import { findNodeAtLocation, getNodeValue, parseTree, type Node as JsoncNode, type ParseError } from "jsonc-parser";
import type { Position, Range } from "@oasis/core";
import { rules } from "./rules/index.ts";
import type { LintDiagnostic, Rule, RuleSeverity } from "./types.ts";

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
  /**
   * Source-ranged diagnostics for structurally invalid fields (wrong type for `entries`,
   * `lint.rules`, `lint.overrides`, or an override's `files`/`rules`); empty when no config was
   * found or every field had a valid shape. The offending field is dropped from `configFile`
   * rather than passed through, so callers (`resolveConfig`, `resolveEntries`) always see a safe
   * shape. See `validateConfigShape`.
   */
  diagnostics: LintDiagnostic[];
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

/** Zero-based line/character positions for every offset in `text` (`node:fs`-read, `\n`-delimited). */
function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

function positionAt(lineStarts: number[], offset: number): Position {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - (lineStarts[lo] ?? 0) };
}

function rangeAt(filePath: string, lineStarts: number[], startOffset: number, endOffset: number): Range {
  return {
    filePath,
    start: positionAt(lineStarts, startOffset),
    end: positionAt(lineStarts, endOffset),
    startOffset,
    endOffset,
  };
}

export interface ConfigValidationResult {
  /** The config coerced to a safe shape: any field that failed validation is dropped/omitted. */
  configFile: LintConfigFile;
  /** Source-ranged diagnostics, one per invalid field. */
  diagnostics: LintDiagnostic[];
}

/**
 * Validate the structural shape of a parsed `oasis.config.jsonc` against `LintConfigFile`, since
 * `parseJsonc`'s output is only checked for JSONC syntax, not runtime shape — a syntactically
 * valid file can still have e.g. `lint.overrides` as an object instead of an array, which downstream
 * code (`resolveConfig`, `resolveEntries`) previously assumed away and would crash or misbehave on.
 *
 * Invalid fields are reported as source-ranged diagnostics (rule `oasis/config`) and dropped from
 * the returned `configFile`, so every caller gets a shape safe to hand to `resolveConfig`/
 * `resolveEntries` without further checking. Nested content this function doesn't itself validate
 * (individual rule config tuples/severities) is left in place: `resolveConfig` already validates
 * those defensively and reports its own config warnings for them.
 */
export function validateConfigShape(text: string, filePath: string): ConfigValidationResult {
  const diagnostics: LintDiagnostic[] = [];
  const lineStarts = computeLineStarts(text);
  const root = parseTree(text, [], { allowTrailingComma: true, disallowComments: false });

  function report(node: JsoncNode | undefined, message: string): void {
    const range = node
      ? rangeAt(filePath, lineStarts, node.offset, node.offset + node.length)
      : rangeAt(filePath, lineStarts, 0, 0);
    diagnostics.push({ rule: "oasis/config", severity: "error", message, range });
  }

  if (!root) return { configFile: {}, diagnostics };
  if (root.type !== "object") {
    report(root, "Config file must be a JSON object at the top level; ignoring its contents.");
    return { configFile: {}, diagnostics };
  }

  const configFile: LintConfigFile = {};

  const entriesNode = findNodeAtLocation(root, ["entries"]);
  if (entriesNode) {
    if (entriesNode.type !== "array") {
      report(entriesNode, '"entries" must be an array of strings; ignoring.');
    } else {
      const validEntries: string[] = [];
      (entriesNode.children ?? []).forEach((child, i) => {
        if (child.type !== "string") {
          report(child, `"entries[${i}]" must be a string; ignoring this entry.`);
          return;
        }
        validEntries.push(getNodeValue(child) as string);
      });
      configFile.entries = validEntries;
    }
  }

  const lintNode = findNodeAtLocation(root, ["lint"]);
  if (lintNode) {
    if (lintNode.type !== "object") {
      report(lintNode, '"lint" must be an object; ignoring.');
    } else {
      const lint: NonNullable<LintConfigFile["lint"]> = {};

      const rulesNode = findNodeAtLocation(lintNode, ["rules"]);
      if (rulesNode) {
        if (rulesNode.type !== "object") {
          report(rulesNode, '"lint.rules" must be an object; ignoring.');
        } else {
          lint.rules = getNodeValue(rulesNode) as Record<string, RuleConfigValue>;
        }
      }

      const overridesNode = findNodeAtLocation(lintNode, ["overrides"]);
      if (overridesNode) {
        if (overridesNode.type !== "array") {
          report(overridesNode, '"lint.overrides" must be an array; ignoring.');
        } else {
          const validOverrides: LintOverride[] = [];
          (overridesNode.children ?? []).forEach((overrideNode, i) => {
            if (overrideNode.type !== "object") {
              report(overrideNode, `"lint.overrides[${i}]" must be an object; ignoring.`);
              return;
            }

            const filesNode = findNodeAtLocation(overrideNode, ["files"]);
            const filesValid =
              filesNode?.type === "array" && (filesNode.children ?? []).every((f) => f.type === "string");
            if (!filesValid) {
              report(filesNode ?? overrideNode, `"lint.overrides[${i}].files" must be an array of strings; ignoring this override.`);
              return;
            }
            const files = (filesNode.children ?? []).map((f) => getNodeValue(f) as string);

            let overrideRules: Record<string, RuleConfigValue> = {};
            const overrideRulesNode = findNodeAtLocation(overrideNode, ["rules"]);
            if (overrideRulesNode) {
              if (overrideRulesNode.type !== "object") {
                report(overrideRulesNode, `"lint.overrides[${i}].rules" must be an object; ignoring.`);
              } else {
                overrideRules = getNodeValue(overrideRulesNode) as Record<string, RuleConfigValue>;
              }
            }

            validOverrides.push({ files, rules: overrideRules });
          });
          lint.overrides = validOverrides;
        }
      }

      configFile.lint = lint;
    }
  }

  return { configFile, diagnostics };
}

/**
 * Load `oasis.config.jsonc`, either from an explicit path or by discovering it upward from `cwd`.
 * Returns an empty config (no error) when no config file is found. Throws if an explicit or
 * discovered config file exists but fails to parse as JSONC. A config file that parses but has an
 * invalid shape (e.g. `lint.overrides` as an object) does not throw: see `validateConfigShape`.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const path = options.configPath
    ? pathResolve(options.configPath)
    : findConfigUpward(options.cwd ?? process.cwd());

  if (!path) return { configFile: {}, path: undefined, diagnostics: [] };

  const text = await readFile(path, "utf-8");
  const errors: ParseError[] = [];
  parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });

  if (errors.length > 0) {
    throw new Error(`Failed to parse config file "${path}": invalid JSONC (error code ${errors[0]?.error})`);
  }

  const { configFile, diagnostics } = validateConfigShape(text, path);
  return { configFile, path, diagnostics };
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
  const rawOverrides = configFile?.lint?.overrides;
  for (const [i, override] of (Array.isArray(rawOverrides) ? rawOverrides : []).entries()) {
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
 * Normalize an OS-native relative path (as produced by `path.relative`, which uses backslashes on
 * Windows) to the forward-slash form that `Bun.Glob` patterns and config `files` globs use.
 * A no-op on POSIX, where `path.relative` already yields forward slashes.
 */
export function toGlobPath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
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

  const relativePath = toGlobPath(pathRelative(configDir, filePath));
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

const GLOB_META_RE = /[*?[{]/;

/** Whether an `entries` string should be treated as a glob pattern rather than a literal path. */
export function isGlobPattern(pattern: string): boolean {
  return GLOB_META_RE.test(pattern);
}

/**
 * Expand a glob `entries` pattern against `configDir` (the directory containing the config file)
 * into absolute file paths, using a real filesystem scan (`Bun.Glob`). Symlinked directories are
 * not followed, hidden (dot) files/dirs never match, and any match under a `node_modules`
 * directory is skipped. Requires real disk access — see `resolveEntries` for why that's fine here.
 */
export function expandGlobEntry(pattern: string, configDir: string): string[] {
  const glob = new Bun.Glob(pattern);
  const matches: string[] = [];
  for (const abs of glob.scanSync({ cwd: configDir, absolute: true, followSymlinks: false })) {
    const rel = pathRelative(configDir, abs);
    if (rel.split(sep).includes("node_modules")) continue;
    matches.push(abs);
  }
  return matches.sort();
}

/**
 * Resolve `configFile.entries` (paths relative to `configDir`, the directory containing the
 * config file) into absolute paths. Entries may be literal paths or glob patterns (containing
 * `* ? [ {`); glob patterns are expanded with `expandGlobEntry`. Missing literal files and globs
 * that match nothing both produce a warning rather than throwing; an absent/empty `entries` field
 * resolves to an empty list with no warnings. Files matched by more than one entry (literal or
 * glob) are deduped, keeping the first occurrence's position.
 */
export function resolveEntries(configFile: LintConfigFile | undefined, configDir: string): ResolvedEntries {
  const entries: string[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];

  const rawEntries = configFile?.entries;
  for (const raw of Array.isArray(rawEntries) ? rawEntries : []) {
    if (typeof raw !== "string") {
      warnings.push(`Entry ${JSON.stringify(raw)} in config is not a string; skipping.`);
      continue;
    }
    if (isGlobPattern(raw)) {
      const matches = expandGlobEntry(raw, configDir);
      if (matches.length === 0) {
        warnings.push(`Entry glob "${raw}" in config matched no files (resolved against "${configDir}"); skipping.`);
        continue;
      }
      for (const abs of matches) {
        if (seen.has(abs)) continue;
        seen.add(abs);
        entries.push(abs);
      }
      continue;
    }

    const abs = pathResolve(configDir, raw);
    if (!existsSync(abs)) {
      warnings.push(`Entry "${raw}" in config not found (resolved to "${abs}"); skipping.`);
      continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    entries.push(abs);
  }

  return { entries, warnings };
}
