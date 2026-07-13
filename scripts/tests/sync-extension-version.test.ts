import { describe, expect, test, afterAll } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
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
    const lockfileRootVersion = lockfile.version;
    const lockfilePackageVersion = lockfile.packages?.[""]?.version;

    expect(lockfileRootVersion).toBe(
      packageVersion,
      `package-lock.json root version (${lockfileRootVersion}) does not match package.json version (${packageVersion})`,
    );

    expect(lockfilePackageVersion).toBe(
      packageVersion,
      `package-lock.json packages[""].version (${lockfilePackageVersion}) does not match package.json version (${packageVersion})`,
    );
  });
});
