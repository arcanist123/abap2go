// Whether the conversion of a literal to a type raises: the rules of docs/spec/conversion.md for a literal source,
// without the converted value. The runtime has the same rules (runtime/go/abap/parse.go and conv.go), and both are
// run over testdata/value_literal.tsv.

import * as abaplint from "@abaplint/core";

const { BasicTypes } = abaplint;

/** A literal as written: the characters of a text literal, or a number literal with its sign. */
export interface SourceLiteral {
  /** A text field literal '...' (c), a string literal `...` or a number literal. */
  readonly kind: "c" | "string" | "number";
  readonly value: string;
}

const MIN_I = -(2n ** 31n);
const MAX_I = 2n ** 31n - 1n;
const MIN_INT8 = -(2n ** 63n);
const MAX_INT8 = 2n ** 63n - 1n;

/** The values of an integer type; undefined for any other type. */
function integerRange(type: abaplint.AbstractType): [bigint, bigint] | undefined {
  if (type instanceof BasicTypes.Integer8Type) {
    return [MIN_INT8, MAX_INT8];
  } else if (!(type instanceof BasicTypes.IntegerType)) {
    return undefined;
  }
  switch (type.getBytes()) {
    case 1: return [0n, 255n]; // b, DDIC INT1
    case 2: return [-32768n, 32767n]; // s, DDIC INT2
    default: return [MIN_I, MAX_I];
  }
}

/**
 * Whether the conversion raises an exception, or is not supported at all. False for a type whose conversion is not
 * checked here: the character-like types, xstring and everything that is not elementary.
 */
export function conversionRaises(source: SourceLiteral, type: abaplint.AbstractType): boolean {
  if (source.kind === "number") {
    return numberRaises(BigInt(source.value), type);
  }
  const text = source.value;
  const range = integerRange(type);
  if (range !== undefined) {
    const value = scaled(text, 0);
    return value === undefined || value < range[0] || value > range[1];
  } else if (type instanceof BasicTypes.PackedType) {
    const value = scaled(text, type.getDecimals());
    return value === undefined || !fitsPacked(value, type.getLength());
  } else if (type instanceof BasicTypes.FloatType || type instanceof BasicTypes.FloatingPointType) {
    return floatRaises(text);
  } else if (type instanceof BasicTypes.DecFloat16Type) {
    return decfloatRaises(text, 16, 384);
  } else if (type instanceof BasicTypes.DecFloat34Type) {
    return decfloatRaises(text, 34, 6144);
  } else if (type instanceof BasicTypes.UTCLongType) {
    return !isTimestamp(text);
  }
  return false;
}

/** A number literal is an i or a p without decimals; none is beyond the range of f or of a decimal type. */
function numberRaises(value: bigint, type: abaplint.AbstractType): boolean {
  const range = integerRange(type);
  if (range !== undefined) {
    return value < range[0] || value > range[1];
  } else if (type instanceof BasicTypes.PackedType) {
    return !fitsPacked(value * 10n ** BigInt(type.getDecimals()), type.getLength());
  } else if (type instanceof BasicTypes.DateType || type instanceof BasicTypes.TimeType
      || type instanceof BasicTypes.HexType) {
    // a p goes into these through an i
    return value < MIN_I || value > MAX_I;
  }
  return type instanceof BasicTypes.UTCLongType; // no conversion from a number
}

/** Whether the unscaled value of a p of this length has at most its 2 * length - 1 digits. */
function fitsPacked(unscaled: bigint, length: number): boolean {
  const limit = 10n ** BigInt(2 * length - 1);
  return unscaled < limit && unscaled > -limit;
}

/**
 * The number of a text for the targets i, int8, b, s and p, rounded half away from zero to the decimals and given
 * without the decimal point; undefined if the text is no number. Blank text is 0. Blanks around the number are
 * ignored; a sign goes in front, perhaps followed by blanks, or at the end, perhaps preceded by blanks.
 */
function scaled(text: string, decimals: number): bigint | undefined {
  let s = trimBlanks(text);
  if (s === "") {
    return 0n;
  }
  let negative = false;
  if (/^[+-]/.test(s)) {
    negative = s.startsWith("-");
    s = s.slice(1).replace(/^ +/, "");
  } else if (/[+-]$/.test(s)) {
    negative = s.endsWith("-");
    s = s.slice(0, -1).replace(/ +$/, "");
  }
  const match = /^(\d*)(?:\.(\d*))?$/.exec(s);
  const whole = match?.[1] ?? "";
  const fraction = match?.[2] ?? "";
  if (match === null || whole + fraction === "") {
    return undefined;
  }
  let value = BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, "0"));
  if ((fraction[decimals] ?? "0") >= "5") {
    value += 1n;
  }
  return negative ? -value : value;
}

/**
 * A text for a decimal floating point number: as for the other numbers, or one token with an exponent. It raises if
 * it is no number, or if the value rounded to the precision is beyond the largest exponent.
 */
function decfloatRaises(text: string, precision: number, maxExponent: number): boolean {
  let s = trimBlanks(text);
  if (s === "") {
    return false;
  }
  let exponent = 0;
  const e = s.search(/[Ee]/);
  if (e >= 0) {
    const written = s.slice(e + 1);
    // an exponent beyond 64 bits is no number to the runtime either
    if (!/^[+-]?\d+$/.test(written) || BigInt(written) < MIN_INT8 || BigInt(written) > MAX_INT8) {
      return true;
    }
    exponent = Number(written);
    s = s.slice(0, e).replace(/^[+-]/, "");
  } else if (/^[+-]/.test(s)) {
    s = s.slice(1).replace(/^ +/, "");
  } else if (/[+-]$/.test(s)) {
    s = s.slice(0, -1).replace(/ +$/, "");
  }
  const match = /^(\d*)(?:\.(\d*))?$/.exec(s);
  const whole = match?.[1] ?? "";
  const fraction = match?.[2] ?? "";
  if (match === null || whole + fraction === "") {
    return true;
  }
  const digits = (whole + fraction).replace(/^0+/, "");
  if (digits === "") {
    return false; // zero, whatever its exponent
  }
  // the exponent of the first digit, one more if rounding carries into a new digit
  const carries = digits.length > precision && /^9+$/.test(digits.slice(0, precision)) && digits[precision] >= "5";
  return exponent - fraction.length + digits.length - 1 + (carries ? 1 : 0) > maxExponent;
}

/**
 * A text for an f, read as C's strtod does, with a sign allowed at the end. Text starting with a blank takes the
 * longest number after the blanks, followed by nothing or a blank, and is 0 without one. Other text starts with a
 * number, followed by a sign (if it has none in front) and then blanks, or by a blank and anything. INF, NAN and a
 * value beyond the range of f raise.
 */
function floatRaises(text: string): boolean {
  const s = text.replace(/ +$/, "");
  if (s === "") {
    return false;
  }
  const leadingBlank = s.startsWith(" ");
  const start = s.replace(/^ +/, "");
  if (/^[+-]?(inf|nan)/i.test(start)) {
    return true;
  }
  const number = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(start)?.[0];
  if (number === undefined) {
    return !leadingBlank;
  }
  if (!Number.isFinite(Number(number))) {
    return true;
  }
  const rest = start.slice(number.length);
  if (rest === "" || rest.startsWith(" ")) {
    return false;
  }
  if (leadingBlank || !/^[+-]( |$)/.test(rest)) {
    return true;
  }
  return /^[+-]/.test(number);
}

/**
 * A text for a utclong: blank, or YYYY-MM-DD, a blank or T, hh:mm:ss, perhaps a point or comma with up to seven
 * digits, then blanks. A date of ABAP's calendar, without the days the Gregorian reform skips; 24:00:00 is the next
 * day, which 9999-12-31 does not have.
 */
function isTimestamp(text: string): boolean {
  const s = text.replace(/ +$/, "");
  if (s === "") {
    return true;
  }
  const match = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:[.,](\d{0,7}))?$/.exec(s);
  if (match === null) {
    return false;
  }
  const [year, month, day, hour, minute, second, fraction] = match.slice(1).map(g => Number(g ?? ""));
  const gregorian = year > 1582 || (year === 1582 && (month > 10 || (month === 10 && day >= 15)));
  const leap = year % 4 === 0 && (!gregorian || year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year < 1 || days === undefined || day < 1 || day > days || (year === 1582 && month === 10 && day > 4 && day < 15)
      || minute > 59 || second > 59 || hour > 24) {
    return false;
  }
  return hour < 24 || (minute === 0 && second === 0 && fraction === 0 && !(year === 9999 && month === 12 && day === 31));
}

/** Without the blanks around it; other white space is part of a number's text. */
function trimBlanks(text: string): string {
  return text.replace(/^ +| +$/g, "");
}
