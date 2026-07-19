import { describe, expect, test } from "bun:test";
import { parseRefString, resolveFileReference, NodeFileSystem } from "@oasis/core";
import { relativeRefPath } from "../src/ref-target-path.ts";

/** Resolve a generated `$ref` file part back to a filesystem path, exactly as `resolveRef` would,
 * so tests can assert the encoded value round-trips to the intended file rather than merely
 * eyeballing the encoded string. */
function resolvedFilePath(fromPath: string, refValue: string): string {
  const { filePart } = parseRefString(refValue);
  return resolveFileReference(new NodeFileSystem(), fromPath, filePart);
}

describe("relativeRefPath (#121)", () => {
  test("plain filenames are left unencoded (no regression)", () => {
    expect(relativeRefPath("/repo/entry.yaml", "/repo/shared.yaml")).toBe("./shared.yaml");
    expect(relativeRefPath("/repo/entry.yaml", "/repo/nested/pet.yaml")).toBe("./nested/pet.yaml");
  });

  test("a `#` in the filename is percent-encoded so it isn't mistaken for the fragment delimiter", () => {
    const result = relativeRefPath("/repo/entry.yaml", "/repo/foo#bar.yaml");
    expect(result).toBe("./foo%23bar.yaml");
    expect(resolvedFilePath("/repo/entry.yaml", `${result}#/components/schemas/Foo`)).toBe("/repo/foo#bar.yaml");
  });

  test("a literal `%` in the filename is percent-encoded so decoding doesn't corrupt it", () => {
    const result = relativeRefPath("/repo/entry.yaml", "/repo/100%.yaml");
    expect(result).toBe("./100%25.yaml");
    expect(resolvedFilePath("/repo/entry.yaml", result)).toBe("/repo/100%.yaml");
  });

  test("a space in the filename is percent-encoded", () => {
    const result = relativeRefPath("/repo/entry.yaml", "/repo/my file.yaml");
    expect(result).toBe("./my%20file.yaml");
    expect(resolvedFilePath("/repo/entry.yaml", result)).toBe("/repo/my file.yaml");
  });

  test("single and double quote characters in the filename are percent-encoded", () => {
    const single = relativeRefPath("/repo/entry.yaml", "/repo/it's.yaml");
    expect(single).toBe("./it%27s.yaml");
    expect(resolvedFilePath("/repo/entry.yaml", single)).toBe("/repo/it's.yaml");

    const double = relativeRefPath("/repo/entry.yaml", '/repo/say"hi".yaml');
    expect(double).toBe("./say%22hi%22.yaml");
    expect(resolvedFilePath("/repo/entry.yaml", double)).toBe('/repo/say"hi".yaml');
  });

  test("Unicode characters in the filename are percent-encoded as UTF-8", () => {
    const result = relativeRefPath("/repo/entry.yaml", "/repo/café.yaml");
    expect(result).toBe("./caf%C3%A9.yaml");
    expect(resolvedFilePath("/repo/entry.yaml", result)).toBe("/repo/café.yaml");
  });

  test("path separators between directory segments are preserved, only the segment content is encoded", () => {
    const result = relativeRefPath("/repo/entry.yaml", "/repo/a#b/c d.yaml");
    expect(result).toBe("./a%23b/c%20d.yaml");
    expect(resolvedFilePath("/repo/entry.yaml", result)).toBe("/repo/a#b/c d.yaml");
  });

  test("a leading `../` from node:path.relative is preserved as literal path syntax, not encoded", () => {
    const result = relativeRefPath("/repo/nested/entry.yaml", "/repo/foo#bar.yaml");
    expect(result).toBe("../foo%23bar.yaml");
    expect(resolvedFilePath("/repo/nested/entry.yaml", result)).toBe("/repo/foo#bar.yaml");
  });
});
