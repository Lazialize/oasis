import { describe, expect, test } from "bun:test";
// Cross-package relative import for tests only (not part of the esbuild bundle or the
// `tsc --noEmit` build — see tsconfig.json's `exclude: ["src/**/*.test.ts"]`). Keeps the
// extension's guard vectors identical to packages/server's without adding a runtime dependency
// from the npm-built extension on the Bun workspace.
import { guardVectors } from "../../../packages/server/tests/fixtures/guard-vectors.ts";
import { looksLikeOpenApiText } from "./openapi-guard.ts";

describe("looksLikeOpenApiText (issue #122: tokenization vectors)", () => {
  for (const vector of guardVectors) {
    test(vector.name, () => {
      expect(looksLikeOpenApiText(vector.input)).toBe(vector.expected);
    });
  }
});
