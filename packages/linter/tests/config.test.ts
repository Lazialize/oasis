import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import {
  effectiveRuleConfig,
  findConfigUpward,
  isGlobPattern,
  loadConfig,
  resolveConfig,
  resolveEntries,
} from "../src/config.ts";
import { rules } from "../src/rules/index.ts";
import type { Rule, RuleContext } from "../src/types.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

/** A rule with options support, used to exercise the option-plumbing/validation paths without touching the real registry. */
function makeFakeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    name: "fake-rule",
    description: "A fake rule for tests.",
    defaultSeverity: "warn",
    defaultOptions: { level: 1 },
    validateOptions(options) {
      if (typeof options !== "object" || options === null || !("level" in options)) {
        return 'expected an object with a "level" property';
      }
      return undefined;
    },
    check() {},
    ...overrides,
  };
}

describe("resolveConfig", () => {
  test("defaults every rule to its own defaultSeverity when no overrides given", () => {
    const resolved = resolveConfig(undefined);
    for (const rule of rules) {
      expect(resolved.rules[rule.name]?.severity).toBe(rule.defaultSeverity);
    }
    expect(resolved.configWarnings).toEqual([]);
  });

  test("applies overrides and reports unknown rule names as warnings, not crashes", () => {
    const resolved = resolveConfig({
      lint: { rules: { "operation/tags": "off", "no-such-rule": "error" } },
    });
    expect(resolved.rules["operation/tags"]?.severity).toBe("off");
    expect(resolved.configWarnings.some((w) => w.includes("no-such-rule"))).toBe(true);
  });

  describe("rule options (array form)", () => {
    const fakeRule = makeFakeRule();

    test("accepts [severity, options] and validates options against the rule", () => {
      const resolved = resolveConfig({ lint: { rules: { "fake-rule": ["error", { level: 5 }] } } }, [fakeRule]);
      expect(resolved.rules["fake-rule"]).toEqual({ severity: "error", options: { level: 5 } });
      expect(resolved.configWarnings).toEqual([]);
    });

    test("falls back to the rule's defaultOptions when no options are given", () => {
      const resolved = resolveConfig({ lint: { rules: { "fake-rule": "error" } } }, [fakeRule]);
      expect(resolved.rules["fake-rule"]).toEqual({ severity: "error", options: { level: 1 } });
    });

    test("rejects an invalid severity in the array form", () => {
      const resolved = resolveConfig(
        { lint: { rules: { "fake-rule": ["not-a-severity" as never, { level: 5 }] } } },
        [fakeRule],
      );
      expect(resolved.rules["fake-rule"]).toEqual({ severity: "warn", options: { level: 1 } }); // default kept
      expect(resolved.configWarnings.some((w) => w.includes("fake-rule"))).toBe(true);
    });

    test("rejects a malformed array (wrong length, non-object options)", () => {
      const resolved = resolveConfig({ lint: { rules: { "fake-rule": ["error"] as never } } }, [fakeRule]);
      expect(resolved.rules["fake-rule"]).toEqual({ severity: "warn", options: { level: 1 } });
      expect(resolved.configWarnings.some((w) => w.includes("fake-rule"))).toBe(true);
    });

    test("rejects options for an unknown rule", () => {
      const resolved = resolveConfig({ lint: { rules: { "no-such-rule": ["error", { level: 5 }] } } }, [fakeRule]);
      expect(resolved.configWarnings.some((w) => w.includes("Unknown rule") && w.includes("no-such-rule"))).toBe(true);
    });

    test("rejects options that fail the rule's own validateOptions", () => {
      const resolved = resolveConfig({ lint: { rules: { "fake-rule": ["error", { wrong: true }] } } }, [fakeRule]);
      expect(resolved.rules["fake-rule"]).toEqual({ severity: "warn", options: { level: 1 } });
      expect(resolved.configWarnings.some((w) => w.includes("Invalid options") && w.includes("fake-rule"))).toBe(true);
    });

    test("a rule without validateOptions accepts any options object", () => {
      const noValidate = makeFakeRule({ validateOptions: undefined });
      const resolved = resolveConfig({ lint: { rules: { "fake-rule": ["error", { anything: 1 }] } } }, [noValidate]);
      expect(resolved.rules["fake-rule"]).toEqual({ severity: "error", options: { anything: 1 } });
      expect(resolved.configWarnings).toEqual([]);
    });
  });
});

describe("engine passes resolved options to the rule context", () => {
  test("ctx.options carries the resolved options object at check time", async () => {
    let seenOptions: unknown;
    const fakeRule: Rule = {
      ...makeFakeRule(),
      check(ctx: RuleContext) {
        seenOptions = ctx.options;
      },
    };
    const fs = new NodeFileSystem();
    const graph = await loadWorkspaceGraph(fs, `${fixturesRoot}/valid/openapi.yaml`);
    const config = resolveConfig({ lint: { rules: { "fake-rule": ["error", { level: 42 }] } } }, [fakeRule]);
    lint(graph, config, {}, [fakeRule]);
    expect(seenOptions).toEqual({ level: 42 });
  });
});

describe("lint.overrides", () => {
  test("effectiveRuleConfig: overrides win over top-level rules, later overrides win, matched relative to configDir", () => {
    const config = resolveConfig({
      lint: {
        rules: { "operation/tags": "warn" },
        overrides: [
          { files: ["paths/**/*.yaml"], rules: { "operation/tags": "off" } },
          { files: ["**/*.yaml"], rules: { "operation/tags": "info" } },
        ],
      },
    });

    // Matches only the second (broader) override.
    expect(effectiveRuleConfig(config, "operation/tags", "/root/entry.yaml", "/root").severity).toBe("info");
    // Matches both; the later override (declared second) wins.
    expect(effectiveRuleConfig(config, "operation/tags", "/root/paths/pets.yaml", "/root").severity).toBe("info");
    // No configDir (no config file loaded): overrides never apply.
    expect(effectiveRuleConfig(config, "operation/tags", "/root/paths/pets.yaml", undefined).severity).toBe("warn");
    // A rule the overrides don't mention keeps its top-level/default resolution.
    expect(effectiveRuleConfig(config, "operation/operation-id", "/root/paths/pets.yaml", "/root").severity).toBe("error");
  });

  test("invalid \"files\" in an override produces a config warning and the override is skipped", () => {
    const config = resolveConfig({
      lint: { overrides: [{ files: "not-an-array" as never, rules: { "operation/tags": "off" } }] },
    });
    expect(config.overrides).toEqual([]);
    expect(config.configWarnings.some((w) => w.includes("overrides[0]"))).toBe(true);
  });

  test("end-to-end: overrides re-enable a globally-off rule for matching files, and win over the top-level rule for others, including $ref'd file attribution", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/overrides/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const { configFile, path } = await loadConfig({ configPath: `${fixturesRoot}/overrides/oasis.config.jsonc` });
    const resolved = resolveConfig(configFile);
    const diagnostics = lint(graph, resolved, { configPath: path });

    // operation/operation-id is off at the top level, but re-enabled (error) by the "paths/**" override.
    // The violation is attributed to the $ref'd file, paths/pets.yaml, not the entry document.
    const opIdDiags = diagnostics.filter((d) => d.rule === "operation/operation-id");
    expect(opIdDiags.length).toBe(1);
    expect(opIdDiags[0]?.severity).toBe("error");
    expect(opIdDiags[0]?.range.filePath).toBe(`${fixturesRoot}/overrides/paths/pets.yaml`);

    // /widgets (in entry.yaml, not under paths/**) is also missing an operationId, but the override
    // only targets paths/**, so it stays off there.
    expect(opIdDiags.some((d) => d.range.filePath === entry)).toBe(false);

    // operation/tags: default warn, "off" under paths/** (override 1), then "info" for every yaml
    // file (override 2, declared later) — override 2 wins wherever both match, i.e. everywhere.
    const tagDiags = diagnostics.filter((d) => d.rule === "operation/tags");
    expect(tagDiags.length).toBe(2); // both /pets (in paths/pets.yaml) and /widgets (in entry.yaml)
    expect(tagDiags.every((d) => d.severity === "info")).toBe(true);
  });
});

describe("loadConfig", () => {
  test("loads an explicit --config path", async () => {
    const { configFile, path } = await loadConfig({ configPath: `${fixturesRoot}/config/oasis.config.jsonc` });
    expect(path).toBe(`${fixturesRoot}/config/oasis.config.jsonc`);
    expect(configFile.lint?.rules?.["operation/tags"]).toBe("off");
  });

  test("discovers oasis.config.jsonc upward from a nested cwd", async () => {
    const { configFile, path } = await loadConfig({ cwd: `${fixturesRoot}/config/nested/subdir` });
    expect(path).toBe(`${fixturesRoot}/config/oasis.config.jsonc`);
    expect(configFile.lint?.rules?.["operation/description"]).toBe("info");
  });

  test("returns an empty config when none is found", async () => {
    const { configFile, path } = await loadConfig({ cwd: "/" });
    expect(path).toBeUndefined();
    expect(configFile).toEqual({});
  });
});

describe("end-to-end config application", () => {
  test("severity override, disabled rule, and unknown rule all take effect together", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/config/target.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const { configFile, path } = await loadConfig({ configPath: `${fixturesRoot}/config/oasis.config.jsonc` });
    const resolved = resolveConfig(configFile);
    const diagnostics = lint(graph, resolved, { configPath: path });

    // operation/tags is "off": no diagnostic despite the fixture having no tags.
    expect(diagnostics.some((d) => d.rule === "operation/tags")).toBe(false);

    // operation/description is overridden to "info".
    const descDiag = diagnostics.find((d) => d.rule === "operation/description");
    expect(descDiag).toBeDefined();
    expect(descDiag?.severity).toBe("info");

    // unknown rule name surfaces as a config warning diagnostic, not a crash.
    const configDiag = diagnostics.find((d) => d.rule === "oasis/config");
    expect(configDiag).toBeDefined();
    expect(configDiag?.message).toContain("no-such-rule");
  });
});

describe("findConfigUpward", () => {
  test("returns undefined when no config file exists above cwd", () => {
    expect(findConfigUpward(`${fixturesRoot}/valid`)).toBeUndefined();
  });
});

describe("resolveEntries", () => {
  test("resolves relative entry paths against the config directory", () => {
    const { entries, warnings } = resolveEntries({ entries: ["target.yaml"] }, `${fixturesRoot}/config`);
    expect(entries).toEqual([`${fixturesRoot}/config/target.yaml`]);
    expect(warnings).toEqual([]);
  });

  test("warns (does not throw) on a missing entry file", () => {
    const { entries, warnings } = resolveEntries({ entries: ["does-not-exist.yaml"] }, `${fixturesRoot}/config`);
    expect(entries).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("does-not-exist.yaml");
  });

  test("absent entries field resolves to an empty list with no warnings", () => {
    const { entries, warnings } = resolveEntries({}, `${fixturesRoot}/config`);
    expect(entries).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("preserves declaration order and skips missing entries in place", () => {
    const { entries, warnings } = resolveEntries(
      { entries: ["target.yaml", "missing.yaml", "nested/subdir"] },
      `${fixturesRoot}/config`,
    );
    expect(entries).toEqual([`${fixturesRoot}/config/target.yaml`, `${fixturesRoot}/config/nested/subdir`]);
    expect(warnings.length).toBe(1);
  });

  describe("glob patterns", () => {
    const globRoot = `${fixturesRoot}/entries-glob`;

    test("isGlobPattern recognizes glob metacharacters and rejects plain paths", () => {
      expect(isGlobPattern("apis/**/openapi.yaml")).toBe(true);
      expect(isGlobPattern("apis/*/openapi.yaml")).toBe(true);
      expect(isGlobPattern("apis/openapi.yaml")).toBe(false);
      expect(isGlobPattern("apis/a/openapi.yaml")).toBe(false);
    });

    test("expands a glob pattern to every matching file, sorted", () => {
      const { entries, warnings } = resolveEntries({ entries: ["apis/*/openapi.yaml"] }, globRoot);
      expect(entries).toEqual([`${globRoot}/apis/a/openapi.yaml`, `${globRoot}/apis/b/openapi.yaml`]);
      expect(warnings).toEqual([]);
    });

    test("skips node_modules even when the pattern would otherwise match it", () => {
      // A node_modules fixture can't be committed (gitignored), so create it on the fly.
      mkdirSync(`${globRoot}/node_modules/apis/c`, { recursive: true });
      writeFileSync(
        `${globRoot}/node_modules/apis/c/openapi.yaml`,
        `openapi: 3.0.3\ninfo:\n  title: C\n  version: "1.0.0"\npaths: {}\n`,
      );

      const { entries } = resolveEntries({ entries: ["**/openapi.yaml"] }, globRoot);
      expect(entries).toEqual([`${globRoot}/apis/a/openapi.yaml`, `${globRoot}/apis/b/openapi.yaml`]);
      expect(entries.some((e) => e.includes("node_modules"))).toBe(false);
    });

    test("a glob matching zero files produces the same warning treatment as a missing literal entry", () => {
      const { entries, warnings } = resolveEntries({ entries: ["apis/*/does-not-exist.yaml"] }, globRoot);
      expect(entries).toEqual([]);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain("apis/*/does-not-exist.yaml");
      expect(warnings[0]).toContain("no files");
    });

    test("dedupes files matched by more than one pattern (literal + glob, or overlapping globs)", () => {
      const { entries, warnings } = resolveEntries(
        { entries: ["apis/a/openapi.yaml", "apis/*/openapi.yaml", "apis/**/openapi.yaml"] },
        globRoot,
      );
      expect(entries).toEqual([`${globRoot}/apis/a/openapi.yaml`, `${globRoot}/apis/b/openapi.yaml`]);
      expect(warnings).toEqual([]);
    });

    test("mixes literal and glob entries in declaration order", () => {
      const { entries, warnings } = resolveEntries({ entries: ["apis/b/openapi.yaml", "apis/*/openapi.yaml"] }, globRoot);
      expect(entries).toEqual([`${globRoot}/apis/b/openapi.yaml`, `${globRoot}/apis/a/openapi.yaml`]);
      expect(warnings).toEqual([]);
    });
  });
});
