import { describe, expect, test } from "bun:test";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { findConfigUpward, loadConfig, resolveConfig } from "../src/config.ts";
import { rules } from "../src/rules/index.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

describe("resolveConfig", () => {
  test("defaults every rule to its own defaultSeverity when no overrides given", () => {
    const resolved = resolveConfig(undefined);
    for (const rule of rules) {
      expect(resolved.rules[rule.name]).toBe(rule.defaultSeverity);
    }
    expect(resolved.configWarnings).toEqual([]);
  });

  test("applies overrides and reports unknown rule names as warnings, not crashes", () => {
    const resolved = resolveConfig({
      lint: { rules: { "operation-tags": "off", "no-such-rule": "error" } },
    });
    expect(resolved.rules["operation-tags"]).toBe("off");
    expect(resolved.configWarnings.some((w) => w.includes("no-such-rule"))).toBe(true);
  });
});

describe("loadConfig", () => {
  test("loads an explicit --config path", async () => {
    const { configFile, path } = await loadConfig({ configPath: `${fixturesRoot}/config/oasis.config.jsonc` });
    expect(path).toBe(`${fixturesRoot}/config/oasis.config.jsonc`);
    expect(configFile.lint?.rules?.["operation-tags"]).toBe("off");
  });

  test("discovers oasis.config.jsonc upward from a nested cwd", async () => {
    const { configFile, path } = await loadConfig({ cwd: `${fixturesRoot}/config/nested/subdir` });
    expect(path).toBe(`${fixturesRoot}/config/oasis.config.jsonc`);
    expect(configFile.lint?.rules?.["operation-description"]).toBe("info");
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

    // operation-tags is "off": no diagnostic despite the fixture having no tags.
    expect(diagnostics.some((d) => d.rule === "operation-tags")).toBe(false);

    // operation-description is overridden to "info".
    const descDiag = diagnostics.find((d) => d.rule === "operation-description");
    expect(descDiag).toBeDefined();
    expect(descDiag?.severity).toBe("info");

    // unknown rule name surfaces as a config warning diagnostic, not a crash.
    const configDiag = diagnostics.find((d) => d.rule === "config");
    expect(configDiag).toBeDefined();
    expect(configDiag?.message).toContain("no-such-rule");
  });
});

describe("findConfigUpward", () => {
  test("returns undefined when no config file exists above cwd", () => {
    expect(findConfigUpward(`${fixturesRoot}/valid`)).toBeUndefined();
  });
});
