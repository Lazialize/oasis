import { describe, expect, test } from "bun:test";
import { looksLikeOpenApi } from "../src/openapi-guard.ts";
import { guardVectors } from "./fixtures/guard-vectors.ts";

describe("looksLikeOpenApi (issue #122: tokenization vectors)", () => {
  for (const vector of guardVectors) {
    test(vector.name, () => {
      expect(looksLikeOpenApi(vector.input)).toBe(vector.expected);
    });
  }
});

describe("looksLikeOpenApi (issue #52: root-only detection)", () => {
  test("root-level YAML openapi key matches", () => {
    expect(looksLikeOpenApi(`openapi: 3.1.0\ninfo:\n  title: T\n`)).toBe(true);
    expect(looksLikeOpenApi(`# comment\nopenapi: 3.0.3\n`)).toBe(true);
    expect(looksLikeOpenApi(`info:\n  title: T\nopenapi: 3.1.0\n`)).toBe(true);
  });

  test("quoted root-level YAML keys match", () => {
    expect(looksLikeOpenApi(`"openapi": 3.1.0\n`)).toBe(true);
    expect(looksLikeOpenApi(`'openapi': 3.1.0\n`)).toBe(true);
  });

  test("nested YAML openapi key does NOT match", () => {
    expect(looksLikeOpenApi(`metadata:\n  openapi: not-a-root-key\n`)).toBe(false);
    expect(looksLikeOpenApi(`a:\n  b:\n    openapi: 3.1.0\n`)).toBe(false);
  });

  test("openapi inside a YAML block scalar or sequence does NOT match", () => {
    expect(looksLikeOpenApi(`description: |\n  openapi: 3.1.0\n`)).toBe(false);
    expect(looksLikeOpenApi(`- openapi: 3.1.0\n`)).toBe(false);
  });

  test("mismatched quotes or non-key positions do NOT match", () => {
    expect(looksLikeOpenApi(`"openapi': 3.1.0\n`)).toBe(false);
    expect(looksLikeOpenApi(`openapi-extras: 3.1.0\n`)).toBe(false);
  });

  test("root-level JSON openapi key matches", () => {
    expect(looksLikeOpenApi(`{"openapi": "3.1.0", "info": {"title": "T"}}`)).toBe(true);
    expect(looksLikeOpenApi(`{\n  "info": {"title": "T"},\n  "openapi": "3.0.3"\n}`)).toBe(true);
    expect(looksLikeOpenApi(`  {"openapi" : "3.1.0"}`)).toBe(true);
  });

  test("nested JSON openapi key does NOT match", () => {
    expect(looksLikeOpenApi(`{"metadata":{"openapi":"x"}}`)).toBe(false);
    expect(looksLikeOpenApi(`{"a": {"b": {"openapi": "3.1.0"}}}`)).toBe(false);
    expect(looksLikeOpenApi(`{"items": [{"openapi": "3.1.0"}]}`)).toBe(false);
  });

  test("'openapi' as a JSON value or inside a string does NOT match", () => {
    expect(looksLikeOpenApi(`{"kind": "openapi"}`)).toBe(false);
    expect(looksLikeOpenApi(`{"note": "openapi: 3.1.0 is great"}`)).toBe(false);
  });

  test("YAML flow mapping at the root matches", () => {
    expect(looksLikeOpenApi(`{openapi: 3.1.0, info: {title: T}}`)).toBe(true);
    expect(looksLikeOpenApi(`{info: {openapi: nested}}`)).toBe(false);
  });

  test("document-start marker with root content matches", () => {
    expect(looksLikeOpenApi(`---\nopenapi: 3.1.0\n`)).toBe(true);
    expect(looksLikeOpenApi(`--- {openapi: 3.1.0}\n`)).toBe(true);
  });

  test("empty and non-mapping documents do NOT match", () => {
    expect(looksLikeOpenApi("")).toBe(false);
    expect(looksLikeOpenApi(`title: just a plain yaml file\n`)).toBe(false);
    expect(looksLikeOpenApi(`[1, 2, 3]`)).toBe(false);
  });

  test("BOM and leading whitespace are tolerated", () => {
    expect(looksLikeOpenApi(`﻿openapi: 3.1.0\n`)).toBe(true);
    expect(looksLikeOpenApi(`\n\n{"openapi": "3.1.0"}`)).toBe(true);
  });
});
