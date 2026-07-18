import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

test("Bun CI runs the compiled-binary suite through the default test command only", () => {
  const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf-8");

  expect(workflow.match(/^\s*run: bun test$/gm)).toHaveLength(1);
  expect(workflow).not.toContain("run: bun run test:bin");
});

test("the compiled-binary suite remains available as an isolated local command", () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));

  expect(packageJson.scripts["test:bin"]).toBe("bun test packages/cli/tests/binary.test.ts");
});
