import { win32 } from "node:path";
import { describe, expect, test } from "bun:test";
import { toRelativeFilePath } from "../src/render/paths.ts";

describe("toRelativeFilePath (POSIX)", () => {
  test("keeps an in-tree name beginning with `..` (e.g. `..generated`) relative (#77)", () => {
    expect(toRelativeFilePath("/repo/..generated/openapi.yaml", "/repo")).toBe(
      "..generated/openapi.yaml",
    );
  });

  test("keeps an in-tree name that is exactly `...` relative", () => {
    expect(toRelativeFilePath("/repo/.../openapi.yaml", "/repo")).toBe(".../openapi.yaml");
  });

  test("keeps an ordinary nested in-tree file relative and forward-slashed", () => {
    expect(toRelativeFilePath("/repo/nested/dir/openapi.yaml", "/repo")).toBe(
      "nested/dir/openapi.yaml",
    );
  });

  test("returns a genuine parent-directory path absolute/unchanged", () => {
    expect(toRelativeFilePath("/outside.yaml", "/repo")).toBe("/outside.yaml");
  });

  test("returns a genuine `../` parent-directory path absolute/unchanged", () => {
    expect(toRelativeFilePath("/parent/outside.yaml", "/repo/nested")).toBe(
      "/parent/outside.yaml",
    );
  });

  test("returns the absolute path unchanged when filePath IS cwd", () => {
    expect(toRelativeFilePath("/repo", "/repo")).toBe("/repo");
  });
});

// `path.relative`/`path.isAbsolute` are host-specific, so a POSIX test runner can't naturally
// produce Windows semantics (drive letters, backslash separators). `toRelativeFilePath` accepts
// an optional `path` module implementation (defaulting to the host's `node:path`) precisely so
// tests can pass `node:path`'s `win32` variant and exercise the classification logic directly
// under Windows rules, on any platform. Mirrors the Windows-shaped-path pattern in
// `sarif.test.ts` (added for #32), which skips real Windows-only behavior on non-win32 hosts;
// here we can verify Windows classification unconditionally via dependency injection instead.
describe("toRelativeFilePath (Windows semantics via path.win32)", () => {
  test("keeps a same-drive in-tree path relative, forward-slashed", () => {
    const result = toRelativeFilePath(
      "C:\\repo\\nested\\openapi.yaml",
      "C:\\repo",
      win32,
    );
    expect(result).toBe("nested/openapi.yaml");
  });

  test("keeps a same-drive in-tree name beginning with `..` relative (#77)", () => {
    const result = toRelativeFilePath(
      "C:\\repo\\..generated\\openapi.yaml",
      "C:\\repo",
      win32,
    );
    expect(result).toBe("..generated/openapi.yaml");
  });

  test("treats a cross-drive path (path.relative returns absolute) as outside cwd (#77)", () => {
    const filePath = "D:\\other\\openapi.yaml";
    const result = toRelativeFilePath(filePath, "C:\\repo", win32);
    expect(result).toBe(filePath);
  });

  test("returns a genuine same-drive parent-directory path absolute/unchanged", () => {
    const filePath = "C:\\outside.yaml";
    const result = toRelativeFilePath(filePath, "C:\\repo\\nested", win32);
    expect(result).toBe(filePath);
  });

  test("returns the absolute path unchanged when filePath IS cwd", () => {
    const filePath = "C:\\repo";
    const result = toRelativeFilePath(filePath, "C:\\repo", win32);
    expect(result).toBe(filePath);
  });
});
