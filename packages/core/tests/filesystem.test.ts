import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "../src/filesystem.ts";

describe("NodeFileSystem.canonicalize (issue #153)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "oasis-fs-canon-"));
    dirs.push(dir);
    return dir;
  }

  test("a symlinked directory alias canonicalizes to the same identity as the real path", () => {
    const root = makeTempDir();
    const realDir = join(root, "real");
    mkdirSync(realDir);
    const entryPath = join(realDir, "entry.yaml");
    writeFileSync(entryPath, "openapi: 3.0.3\n");
    const aliasDir = join(root, "alias");
    symlinkSync(realDir, aliasDir, "dir");

    const fs = new NodeFileSystem();
    const viaReal = fs.canonicalize(entryPath);
    const viaAlias = fs.canonicalize(join(aliasDir, "entry.yaml"));

    expect(viaAlias).toBe(viaReal);
  });

  test("canonicalization is idempotent", () => {
    const root = makeTempDir();
    const entryPath = join(root, "entry.yaml");
    writeFileSync(entryPath, "openapi: 3.0.3\n");

    const fs = new NodeFileSystem();
    const once = fs.canonicalize(entryPath);
    const twice = fs.canonicalize(once);

    expect(twice).toBe(once);
  });

  test("a missing path canonicalizes deterministically", () => {
    const root = makeTempDir();
    const missing = join(root, "does-not-exist.yaml");

    const fs = new NodeFileSystem();
    const first = fs.canonicalize(missing);
    const second = fs.canonicalize(missing);

    // The leaf name is preserved verbatim (it can't be realpath'd since it doesn't exist); only
    // an existing ancestor directory may have been resolved to its physical form.
    expect(first.endsWith("does-not-exist.yaml")).toBe(true);
    expect(second).toBe(first);
  });

  test("a missing path reached through an existing symlinked directory still canonicalizes deterministically", () => {
    const root = makeTempDir();
    const realDir = join(root, "real");
    mkdirSync(realDir);
    const aliasDir = join(root, "alias");
    symlinkSync(realDir, aliasDir, "dir");

    const fs = new NodeFileSystem();
    const viaAlias = fs.canonicalize(join(aliasDir, "missing.yaml"));
    const viaReal = fs.canonicalize(join(realDir, "missing.yaml"));

    expect(viaAlias).toBe(viaReal);
  });

  // Only meaningful on case-insensitive filesystems (default macOS/Windows). Detected at runtime
  // rather than assumed from `process.platform` so CI on case-sensitive Linux doesn't skip
  // spuriously and this doesn't false-fail on a case-sensitive macOS volume.
  test("differently cased paths canonicalize to the same, on-disk-cased identity on case-insensitive filesystems", () => {
    const root = makeTempDir();
    const entryPath = join(root, "Entry.yaml");
    writeFileSync(entryPath, "openapi: 3.0.3\n");
    const caseInsensitive = existsSync(join(root, "entry.yaml"));
    if (!caseInsensitive) return;

    const fs = new NodeFileSystem();
    const canonical = fs.canonicalize(join(root, "entry.yaml"));
    const canonicalOtherCase = fs.canonicalize(join(root, "ENTRY.yaml"));

    expect(canonicalOtherCase).toBe(canonical);
    // The recovered identity carries the on-disk casing, not whichever case happened to be typed.
    expect(canonical.endsWith("Entry.yaml")).toBe(true);
  });
});
