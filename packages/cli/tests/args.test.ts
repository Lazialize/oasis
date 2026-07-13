import { describe, expect, test } from "bun:test";
import { hasHelpFlag, parseBundleArgs, parseLintArgs } from "../src/args.ts";

describe("hasHelpFlag", () => {
  test("detects -h/--help before `--`", () => {
    expect(hasHelpFlag(["--help"])).toBe(true);
    expect(hasHelpFlag(["-h"])).toBe(true);
    expect(hasHelpFlag(["lint.yaml", "--help"])).toBe(true);
  });

  test("does not treat a positional `--help` after `--` as the help flag (#31)", () => {
    expect(hasHelpFlag(["--", "--help"])).toBe(false);
    expect(hasHelpFlag(["--", "-h"])).toBe(false);
  });

  test("no help flag present", () => {
    expect(hasHelpFlag(["entry.yaml", "--format", "json"])).toBe(false);
  });
});

describe("parseLintArgs", () => {
  test("rejects a single-dash unknown flag (not just double-dash)", () => {
    const result = parseLintArgs(["-format", "json"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unknown flag "-format"');
  });

  test("still rejects unknown double-dash flags", () => {
    const result = parseLintArgs(["--bogus"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unknown flag "--bogus"');
  });

  test("`--` treats everything after it as positional, even dash-prefixed entries", () => {
    const result = parseLintArgs(["--", "-weird.yaml", "--format"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.entries).toEqual(["-weird.yaml", "--format"]);
  });

  test("flags before `--` still parse normally", () => {
    const result = parseLintArgs(["--format", "json", "--", "-weird.yaml"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.format).toBe("json");
      expect(result.value.entries).toEqual(["-weird.yaml"]);
    }
  });

  test("rejects a recognized flag consumed as --config's value (#31)", () => {
    const result = parseLintArgs(["--config", "--format", "json"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--config requires a path argument");
  });

  test("rejects a recognized flag consumed as --format's value (#31)", () => {
    const result = parseLintArgs(["--format", "--config"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--format requires a value argument");
  });

  test("`--config=value` escape hatch accepts a dash-prefixed value", () => {
    const result = parseLintArgs(["--config=--weird-path.jsonc"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.configPath).toBe("--weird-path.jsonc");
  });
});

describe("parseBundleArgs", () => {
  test("`--` treats everything after it as positional, even dash-prefixed entries", () => {
    const result = parseBundleArgs(["--", "-weird.yaml"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.entry).toBe("-weird.yaml");
  });

  test("flags before `--` still parse normally", () => {
    const result = parseBundleArgs(["--dereference", "--", "-weird.yaml"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dereference).toBe(true);
      expect(result.value.entry).toBe("-weird.yaml");
    }
  });

  test("still rejects unknown single-dash flags", () => {
    const result = parseBundleArgs(["-x"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unknown flag "-x"');
  });

  test("rejects a recognized flag consumed as --out's value (#31)", () => {
    const result = parseBundleArgs(["entry.yaml", "--out", "--format"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--out requires a path argument");
  });

  test("rejects a recognized flag consumed as -o's value (#31)", () => {
    const result = parseBundleArgs(["entry.yaml", "-o", "--dereference"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("-o requires a path argument");
  });

  test("`--out=value` escape hatch accepts a dash-prefixed value", () => {
    const result = parseBundleArgs(["entry.yaml", "--out=--weird-out.yaml"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.outPath).toBe("--weird-out.yaml");
  });
});
