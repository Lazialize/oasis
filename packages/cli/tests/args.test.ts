import { describe, expect, test } from "bun:test";
import { parseBundleArgs, parseLintArgs } from "../src/args.ts";

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
});
