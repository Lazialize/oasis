import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateFormula,
  parseShasums,
  selectAssetShasums,
} from "../generate-formula.ts";

const template = readFileSync(
  join(import.meta.dir, "..", "oasis.rb.tmpl"),
  "utf8",
);

const SAMPLE_SHASUMS = `
348eec3b2976dd7b698c1cfe4151016e179799beadd706c2feb5078049a5aae7  oasis-darwin-arm64.tar.gz
2f301c6dbaa9d6d579ca48ff970cae7ee0673494e5a75afb9bdf7f0a0cfb3cd6  oasis-darwin-x64.tar.gz
c9ceb4ff0758987a4c65eea4e64daabd43065e4514d257ae4eea7a6f31a16f64  oasis-linux-arm64.tar.gz
8032483acd536474b8bf043f0ea70762ab95516737488a5fdd2be3b10dd5980b  oasis-linux-x64.tar.gz
8d7aeb502019c06b2adc7f9f1dadc772233a226ad8319a3c13af01672085ece9  oasis-vscode-vsix.vsix
`;

describe("parseShasums", () => {
  test("parses shasum -a 256 output into a filename -> sha256 map", () => {
    const parsed = parseShasums(SAMPLE_SHASUMS);
    expect(parsed.get("oasis-darwin-arm64.tar.gz")).toBe(
      "348eec3b2976dd7b698c1cfe4151016e179799beadd706c2feb5078049a5aae7",
    );
    expect(parsed.size).toBe(5);
  });

  test("ignores blank lines and is case-insensitive on hashes", () => {
    const parsed = parseShasums("\n\n" + SAMPLE_SHASUMS + "\n\n");
    expect(parsed.get("oasis-linux-x64.tar.gz")).toBe(
      "8032483acd536474b8bf043f0ea70762ab95516737488a5fdd2be3b10dd5980b",
    );
  });
});

describe("selectAssetShasums", () => {
  test("extracts the four required release assets", () => {
    const shasums = selectAssetShasums(parseShasums(SAMPLE_SHASUMS));
    expect(shasums).toEqual({
      darwinArm64:
        "348eec3b2976dd7b698c1cfe4151016e179799beadd706c2feb5078049a5aae7",
      darwinX64:
        "2f301c6dbaa9d6d579ca48ff970cae7ee0673494e5a75afb9bdf7f0a0cfb3cd6",
      linuxArm64:
        "c9ceb4ff0758987a4c65eea4e64daabd43065e4514d257ae4eea7a6f31a16f64",
      linuxX64:
        "8032483acd536474b8bf043f0ea70762ab95516737488a5fdd2be3b10dd5980b",
    });
  });

  test("throws a clear error when an asset is missing", () => {
    const shasums = parseShasums(
      "348eec3b2976dd7b698c1cfe4151016e179799beadd706c2feb5078049a5aae7  oasis-darwin-arm64.tar.gz",
    );
    expect(() => selectAssetShasums(shasums)).toThrow(
      /Missing sha256 for required release asset\(s\).*oasis-darwin-x64\.tar\.gz/s,
    );
  });
});

describe("generateFormula", () => {
  const shasums = selectAssetShasums(parseShasums(SAMPLE_SHASUMS));

  test("fills every template placeholder", () => {
    const formula = generateFormula({ version: "1.2.3", shasums, template });
    expect(formula).not.toContain("{{");
    expect(formula).toContain('version "1.2.3"');
    expect(formula).toContain(
      "https://github.com/Lazialize/oasis/releases/download/v1.2.3/oasis-darwin-arm64.tar.gz",
    );
    expect(formula).toContain(shasums.darwinArm64);
    expect(formula).toContain(shasums.darwinX64);
    expect(formula).toContain(shasums.linuxArm64);
    expect(formula).toContain(shasums.linuxX64);
    expect(formula).toContain("class Oasis < Formula");
  });

  test("rejects a version with a leading v", () => {
    expect(() =>
      generateFormula({ version: "v1.2.3", shasums, template }),
    ).toThrow(/must not include the leading "v"/);
  });

  test("throws if the template has an unresolved placeholder", () => {
    expect(() =>
      generateFormula({
        version: "1.2.3",
        shasums,
        template: template + "\n{{NOT_A_REAL_TOKEN}}",
      }),
    ).toThrow(/unresolved placeholder/);
  });
});
