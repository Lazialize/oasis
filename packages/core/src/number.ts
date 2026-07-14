/**
 * Exact-precision numeric literals.
 *
 * YAML/JSON scalars are composed into JS `Number`s during parsing, which silently rounds any
 * integer beyond `Number.MAX_SAFE_INTEGER` or any decimal carrying more significant digits than an
 * IEEE-754 double can hold (e.g. `9007199254740993` -> `9007199254740992`). We deliberately keep
 * the composed `Scalar.value` a `Number`: linter type checks throughout depend on
 * `typeof node.value === "number"`, and turning big numbers into BigInt/wrappers would make valid
 * `maximum`/`const`/`multipleOf` literals read as non-numeric. A yaml `Scalar` node, however, also
 * retains its original source text on `.source`. This module compares the two so serializers
 * (the bundler) can emit the exact literal when — and only when — the rounded `Number` would denote
 * a different real value than the source.
 */

/**
 * A numeric literal whose exact source text cannot be recovered from its rounded JS `Number`.
 * Serializers emit {@link PreciseNumber.source} verbatim; everything else can still treat it as a
 * number via {@link PreciseNumber.valueOf} (comparisons/arithmetic fall back to the rounded double).
 */
export class PreciseNumber {
  constructor(
    readonly source: string,
    readonly value: number,
  ) {}

  valueOf(): number {
    return this.value;
  }

  toString(): string {
    return this.source;
  }
}

interface Decimal {
  /** Signed significant digits with trailing zeros stripped. */
  mantissa: bigint;
  /** Power of ten: the real value is `mantissa * 10 ** exponent`. */
  exponent: number;
}

/**
 * Parse a plain decimal numeric string into a canonical `mantissa * 10 ** exponent`, or `null` if
 * it is not a finite decimal literal (hex/octal, `.inf`, `.nan`, empty, ...). Trailing zeros are
 * normalized away so that `1.50`, `1.5`, and `15e-1` all compare equal.
 */
function parseDecimal(text: string): Decimal | null {
  const match = /^([-+]?)(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d+))?$/.exec(text);
  if (!match) return null;
  const sign = match[1] ?? "";
  const intPart = match[2] ?? "";
  const fracPart = match[3] ?? "";
  const expPart = match[4];
  const digits = intPart + fracPart;
  if (digits === "") return null; // reject "", ".", "e5" and similar non-numbers.

  let mantissa: bigint;
  try {
    mantissa = BigInt(digits);
  } catch {
    return null;
  }
  if (mantissa === 0n) return { mantissa: 0n, exponent: 0 };
  if (sign === "-") mantissa = -mantissa;

  let exponent = (expPart ? Number(expPart) : 0) - fracPart.length;
  while (mantissa % 10n === 0n) {
    mantissa /= 10n;
    exponent += 1;
  }
  return { mantissa, exponent };
}

/**
 * If serializing the JS `Number` `value` (as `String(value)` would) denotes a *different* real
 * number than `source` — i.e. parsing lost precision — return a {@link PreciseNumber} carrying the
 * exact `source`. Otherwise return `value` unchanged: cosmetic-only differences such as `1.0` vs
 * `1` or `1e3` vs `1000` are NOT preserved, so ordinary numeric output stays normalized.
 */
export function preserveNumericLiteral(value: number, source: string | undefined): number | PreciseNumber {
  if (source === undefined || !Number.isFinite(value)) return value;
  // Only plain decimal literals are candidates for exact preservation. Non-decimal forms (YAML
  // core-schema hex/octal like `0x1F`/`0o17`) can't be spliced into JSON output verbatim, and
  // their composed Number is exact anyway (they have no fraction/exponent), so emit the
  // normalized decimal value.
  const sourceDecimal = parseDecimal(source);
  if (!sourceDecimal) return value;
  // `String(value)` is the shortest decimal that round-trips to `value` — exactly what both
  // `JSON.stringify` and yaml's number stringifier would emit.
  const valueDecimal = parseDecimal(String(value));
  if (!valueDecimal) return value;
  if (sourceDecimal.mantissa === valueDecimal.mantissa && sourceDecimal.exponent === valueDecimal.exponent) return value;
  return new PreciseNumber(source, value);
}
