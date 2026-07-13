import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Test that the vscode package.json and package-lock.json versions remain in sync.
 * This test reads the actual files from the repository to ensure they're consistent.
 */
describe("extension version sync", () => {
  test("package.json and package-lock.json are in sync", () => {
    const rootDir = join(import.meta.dir, "../..");
    const vscodePackagePath = join(rootDir, "editors/vscode/package.json");
    const vscodePackageLockPath = join(rootDir, "editors/vscode/package-lock.json");

    const vscodePackage = JSON.parse(readFileSync(vscodePackagePath, "utf8"));
    const lockfile = JSON.parse(readFileSync(vscodePackageLockPath, "utf8"));

    const packageVersion = vscodePackage.version;

    expect(lockfile.version).toBe(packageVersion);
    expect(lockfile.packages?.[""]?.version).toBe(packageVersion);
  });
});
