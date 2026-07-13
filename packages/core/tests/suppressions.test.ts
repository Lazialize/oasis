import { describe, expect, test } from "bun:test";
import { extractSuppressions, isSuppressed } from "../src/suppressions.ts";

describe("extractSuppressions", () => {
  test("oasis-disable-next-line with a single rule targets the following line only", () => {
    const text = ["foo: 1", "# oasis-disable-next-line rule-a", "bar: 2"].join("\n");
    const suppressions = extractSuppressions(text);
    expect(isSuppressed(suppressions, "rule-a", 2)).toBe(true);
    expect(isSuppressed(suppressions, "rule-b", 2)).toBe(false);
    expect(isSuppressed(suppressions, "rule-a", 0)).toBe(false);
  });

  test("oasis-disable-next-line accepts comma- and/or space-separated rule lists", () => {
    const comma = extractSuppressions(["# oasis-disable-next-line rule-a,rule-b", "x: 1"].join("\n"));
    expect(isSuppressed(comma, "rule-a", 1)).toBe(true);
    expect(isSuppressed(comma, "rule-b", 1)).toBe(true);

    const space = extractSuppressions(["# oasis-disable-next-line rule-a rule-b", "x: 1"].join("\n"));
    expect(isSuppressed(space, "rule-a", 1)).toBe(true);
    expect(isSuppressed(space, "rule-b", 1)).toBe(true);
  });

  test("oasis-disable-next-line with no rule names suppresses everything on that line", () => {
    const suppressions = extractSuppressions(["# oasis-disable-next-line", "x: 1"].join("\n"));
    expect(isSuppressed(suppressions, "anything", 1)).toBe(true);
  });

  test("oasis-disable-file suppresses a named rule anywhere in the file, regardless of line", () => {
    const suppressions = extractSuppressions(["# oasis-disable-file rule-a", "x: 1", "y: 2"].join("\n"));
    expect(isSuppressed(suppressions, "rule-a", 0)).toBe(true);
    expect(isSuppressed(suppressions, "rule-a", 99)).toBe(true);
    expect(isSuppressed(suppressions, "rule-b", 1)).toBe(false);
  });

  test("oasis-disable-file with no rule names suppresses every rule in the file", () => {
    const suppressions = extractSuppressions("# oasis-disable-file\nx: 1");
    expect(isSuppressed(suppressions, "anything", 1)).toBe(true);
  });

  test("unknown rule names are inert, not an error", () => {
    const suppressions = extractSuppressions(["# oasis-disable-next-line not-a-real-rule", "x: 1"].join("\n"));
    expect(isSuppressed(suppressions, "not-a-real-rule", 1)).toBe(true);
    expect(isSuppressed(suppressions, "real-rule", 1)).toBe(false);
  });

  test("a genuine trailing comment on the same line still suppresses (end-of-line directive)", () => {
    const suppressions = extractSuppressions(
      ["foo: 1 # oasis-disable-next-line rule-a", "bar: 2"].join("\n"),
    );
    expect(isSuppressed(suppressions, "rule-a", 1)).toBe(true);
  });

  test("directive-looking text inside a block scalar (|) is not a real directive", () => {
    const text = [
      "foo:",
      "  description: |",
      "    See the note below.",
      "    #oasis-disable-next-line rule-a",
      "    more text",
      "bar: 2",
    ].join("\n");
    const suppressions = extractSuppressions(text);
    // Line 5 (0-based) is `bar: 2`, immediately following the fake directive line; it must not
    // be suppressed since the "directive" is just scalar content, not a YAML comment.
    expect(isSuppressed(suppressions, "rule-a", 5)).toBe(false);
    expect(suppressions.nextLine.size).toBe(0);
    expect(suppressions.file).toBeUndefined();
  });

  test("directive-looking text inside a folded block scalar (>) is not a real directive", () => {
    const text = [
      "foo:",
      "  description: >",
      "    # oasis-disable-file rule-a",
      "bar: 2",
    ].join("\n");
    const suppressions = extractSuppressions(text);
    expect(isSuppressed(suppressions, "rule-a", 0)).toBe(false);
    expect(suppressions.file).toBeUndefined();
  });

  test("directive-looking text inside a single-quoted string is not a real directive", () => {
    const text = ["foo: 'text # oasis-disable-next-line rule-a more'", "bar: 2"].join("\n");
    const suppressions = extractSuppressions(text);
    expect(isSuppressed(suppressions, "rule-a", 1)).toBe(false);
  });

  test("directive-looking text inside a double-quoted string is not a real directive", () => {
    const text = ["foo: \"text # oasis-disable-file rule-a more\"", "bar: 2"].join("\n");
    const suppressions = extractSuppressions(text);
    expect(isSuppressed(suppressions, "rule-a", 0)).toBe(false);
    expect(suppressions.file).toBeUndefined();
  });

  test("a genuine oasis-disable-file comment nested after a block scalar still suppresses", () => {
    const text = [
      "foo:",
      "  description: |",
      "    hello",
      "# oasis-disable-file rule-a",
      "bar: 2",
    ].join("\n");
    const suppressions = extractSuppressions(text);
    expect(isSuppressed(suppressions, "rule-a", 0)).toBe(true);
    expect(isSuppressed(suppressions, "rule-a", 99)).toBe(true);
  });

  test("a malformed document does not crash extraction", () => {
    expect(() => extractSuppressions("foo: [1, 2\nbar: }")).not.toThrow();
  });

  test("JSON documents are unaffected (no comments, no crash)", () => {
    const suppressions = extractSuppressions('{"foo": 1, "bar": 2}');
    expect(suppressions.file).toBeUndefined();
    expect(suppressions.nextLine.size).toBe(0);
  });
});
