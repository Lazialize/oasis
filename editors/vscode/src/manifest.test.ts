import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as path from "path";

describe("package.json manifest", () => {
  test("includes recursive activation event for nested oasis.config.jsonc", () => {
    // Read the package.json from the editors/vscode directory
    const packageJsonPath = path.join(import.meta.dir, "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

    // Verify the activationEvents include the recursive glob pattern
    expect(packageJson.activationEvents).toContain("workspaceContains:**/oasis.config.jsonc");
  });
});
