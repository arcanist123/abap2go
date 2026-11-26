import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classrun, run } from "./harness";

// DO n TIMES and CASE with arithmetic expressions and built-in functions. n is a numeric expression position of type
// i: an expression there is calculated as for an i result field. The operand of CASE is calculated first, an
// arithmetic expression in the calculation type of its own operands, and compared with each WHEN value as a data
// object (docs/spec/comparison.md, "CASE").

// out->write( ) of an i writes it converted to a string, with the blank of its sign after it
const lines = (...l: (string | number)[]) => l.map(x => typeof x === "number" ? `${x} \n` : `${x}\n`).join("");

const DATA = `DATA z TYPE i.
DATA a TYPE i VALUE 1.
DATA b TYPE i VALUE 3.
DATA c2 TYPE i VALUE 2.
DATA c7 TYPE i VALUE 7.
DATA imax TYPE i VALUE 2147483647.
DATA imin TYPE i.
DATA neg TYPE i VALUE -1.
DATA i8 TYPE int8 VALUE 5000000000.
DATA p0 TYPE p LENGTH 8 DECIMALS 0.
DATA p1 TYPE p LENGTH 8 DECIMALS 0 VALUE 1.
DATA p2 TYPE p LENGTH 8 DECIMALS 0 VALUE 2.
DATA p3 TYPE p LENGTH 8 DECIMALS 0 VALUE 3.
DATA p5 TYPE p LENGTH 8 DECIMALS 0 VALUE 5.
DATA p7 TYPE p LENGTH 8 DECIMALS 0 VALUE 7.
DATA pm TYPE p LENGTH 8 DECIMALS 1 VALUE '-2.5'.
DATA q TYPE p LENGTH 8 DECIMALS 2 VALUE '1.50'.
DATA m TYPE p LENGTH 16 DECIMALS 10 VALUE '1.5'.
DATA m1 TYPE p LENGTH 16 DECIMALS 10 VALUE '1.0000000001'.
DATA big TYPE p LENGTH 16 DECIMALS 0 VALUE '100000000000000000000'.
DATA f TYPE f VALUE 1.
DATA fr TYPE f.
DATA fbig TYPE f VALUE '1E10'.
DATA df TYPE decfloat34 VALUE 1.
DATA c TYPE c LENGTH 10 VALUE '2.50'.
DATA c1 TYPE c LENGTH 10 VALUE '7'.
DATA cm TYPE c LENGTH 10 VALUE '-2.5'.
DATA cn TYPE c LENGTH 10 VALUE '-1.250'.
DATA cbig TYPE c LENGTH 12 VALUE '3000000000'.
DATA cz TYPE c LENGTH 20 VALUE '0.000000000000000'.
DATA text TYPE c LENGTH 3 VALUE 'abc'.
DATA x TYPE x LENGTH 1 VALUE '0A'.
DATA s TYPE string VALUE \`abc\`.
DATA off TYPE i VALUE 5.
DATA k TYPE i.
imin = - imax - 1.
`;

const abap = (body: string) => run("clas", classrun(DATA + body));

test("DO n TIMES: an arithmetic expression or a built-in function is calculated as for an i result field", () => {
  const counts: [string, number][] = [
    ["c7 / c2", 4], // the calculation type is i, so the quotient is rounded
    ["p5 / p2", 3], // calculated in p, 2.5 rounded when it goes into the i
    ["c7 / c2 * c2", 8],
    ["p7 / p2 * p2", 7],
    ["p1 / p3 * p3", 1],
    ["a / b * b", 0],
    ["strlen( s )", 3],
    ["abs( pm )", 3],
    ["abs( cm )", 3],
    ["sqrt( c2 ) * 2", 3],
    ["z - 5", 0],
    ["x + 0", 10],
    ["ipow( base = c2 exp = 3 )", 8],
    ["( pm )", 0],
    ["- pm", 3],
  ];
  const body = counts.map(([n]) => `k = 0.\nDO ${n} TIMES.\n  k = k + 1.\nENDDO.\nout->write( k ).`).join("\n");
  assert.deepEqual(abap(body), { stdout: lines(...counts.map(([, passes]) => passes)) });
});

test("DO n TIMES: the expression is calculated once, with sy-index of the loop around it", () => {
  const result = abap(`k = 2.
DO k + 1 TIMES.
  k = k + 5.
  out->write( sy-index ).
ENDDO.
DO 3 TIMES.
  DO sy-index * 2 TIMES.
    k = sy-index.
  ENDDO.
  out->write( sy-index ).
  out->write( k ).
ENDDO.`);
  assert.deepEqual(result, { stdout: lines(1, 2, 3, 1, 2, 2, 4, 3, 6) });
});

const EXCEPTIONS = ["CX_SY_ZERODIVIDE", "CX_SY_ARITHMETIC_OVERFLOW", "CX_SY_CONVERSION_OVERFLOW",
  "CX_SY_CONVERSION_NO_NUMBER", "CX_SY_ARG_OUT_OF_DOMAIN", "CX_SY_RANGE_OUT_OF_BOUNDS"];

/** body in a TRY that writes the class of the exception it raises. */
const caught = (body: string) => `TRY.
${body}
${EXCEPTIONS.map(cx => `  CATCH ${cx}.\n    out->write( '${cx}' ).`).join("\n")}
ENDTRY.`;

test("DO n TIMES: an exception of the expression, or of its result going into i, and no pass runs", () => {
  const cases: [string, string][] = [
    ["a / z", "CX_SY_ZERODIVIDE"],
    ["imax + 1", "CX_SY_ARITHMETIC_OVERFLOW"],
    ["i8 + 0", "CX_SY_CONVERSION_OVERFLOW"],
    ["fbig * 1", "CX_SY_CONVERSION_OVERFLOW"],
    ["big * 1", "CX_SY_ARITHMETIC_OVERFLOW"], // a p result that does not fit
    ["abs( imin )", "CX_SY_ARITHMETIC_OVERFLOW"],
    ["abs( i8 )", "CX_SY_CONVERSION_OVERFLOW"],
    ["abs( fbig )", "CX_SY_CONVERSION_OVERFLOW"],
    ["abs( cbig )", "CX_SY_ARITHMETIC_OVERFLOW"],
    ["- fbig", "CX_SY_CONVERSION_OVERFLOW"],
    ["sqrt( neg )", "CX_SY_ARG_OUT_OF_DOMAIN"],
    ["text + 0", "CX_SY_CONVERSION_NO_NUMBER"],
  ];
  const body = cases.map(([n]) => caught(`    DO ${n} TIMES.\n      out->write( 'pass' ).\n    ENDDO.`)).join("\n");
  assert.deepEqual(abap(body), { stdout: lines(...cases.map(([, cx]) => cx)) });
});

test("CASE: an arithmetic expression is calculated in the calculation type of its own operands", () => {
  const result = abap(`CASE a / b * b.
  WHEN 1.
    out->write( 'one' ).
  WHEN 0.
    out->write( 'zero, in i' ).
ENDCASE.
CASE a / b * b.
  WHEN df.
    out->write( 'one' ).
  WHEN OTHERS.
    out->write( 'a decfloat34 value does not take part' ).
ENDCASE.
${caught(`    CASE imax + 1.
      WHEN i8.
    ENDCASE.`)}
CASE imax + i8.
  WHEN 0.
  WHEN OTHERS.
    out->write( 'in int8' ).
ENDCASE.
fr = f / 3.
CASE f / 3.
  WHEN fr.
    out->write( 'in f' ).
ENDCASE.
CASE p1 / p3 * p3.
  WHEN 1.
    out->write( 'p keeps its digits' ).
ENDCASE.
CASE c + 0.
  WHEN '2.5'.
    out->write( 'text in p' ).
ENDCASE.`);
  assert.deepEqual(result, {
    stdout: lines("zero, in i", "a decfloat34 value does not take part", "CX_SY_ARITHMETIC_OVERFLOW", "in int8", "in f",
      "p keeps its digits", "text in p"),
  });
});

/**
 * Two texts around the number value that tell whether a p holding it has exactly decimals of them, as a text is
 * rounded to the decimals of the p it is compared with: down has a 4 in the last of those places, so it equals the p
 * only with fewer decimals; up has a 4 in the place after it, so it equals the p unless that has more.
 */
function around(value: string, decimals: number): { down: string | undefined; up: string } {
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const scaled = BigInt(whole + fraction.padEnd(decimals + 1, "0"));
  const text = (v: bigint) => {
    const digits = v.toString().padStart(decimals + 2, "0");
    return `${value.startsWith("-") ? "-" : ""}${digits.slice(0, -(decimals + 1))}.${digits.slice(-(decimals + 1))}`;
  };
  return { down: decimals === 0 ? undefined : text(scaled + 40n), up: text(scaled + 4n) };
}

test("CASE: a p result has the decimals it would have in a string, up to 14", () => {
  const cases: [string, string, number][] = [
    ["q + 0", "1.5", 2],
    ["- q", "-1.5", 2],
    ["q - q", "0", 0],
    ["q * 1", "1.5", 3],
    ["q * q", "2.25", 3],
    ["p3 * q * q", "6.75", 4],
    ["- ( p2 * q )", "-3", 3],
    ["p3 * p2", "6", 1],
    ["m * 1", "1.5", 3],
    ["p3 * '0.5'", "1.5", 2],
    ["p3 / p2", "1.5", 1],
    ["p2 / p2", "1", 0],
    ["p2 / p3", "0.66666666666667", 14],
    ["m1 * m1", "1.0000000002", 14],
    ["q + m", "3", 10],
    ["m - q", "0", 0],
    ["p0 + 0", "0", 0],
    ["p3 + 0", "3", 0],
    ["i3 + p1", "4", 0],
    ["c + 0", "2.5", 2],
    ["c1 + 0", "7", 0],
    ["abs( c ) + 0", "2.5", 2],
    ["abs( c ) * 1", "2.5", 3],
    ["abs( q + 0 )", "1.5", 2],
    ["p3 DIV p2", "1", 0],
    ["q DIV p1", "1", 0],
    ["q MOD p1", "0.5", 1],
    ["ipow( base = q exp = 2 )", "2.25", 4],
    ["ipow( base = q exp = 0 )", "1", 0],
    ["ipow( base = p2 exp = 3 )", "8", 1],
  ];
  const body = "DATA i3 TYPE i VALUE 3.\n" + cases.map(([operand, value, decimals]) => {
    const { down, up } = around(value, decimals);
    const first = down === undefined ? "" : `  WHEN '${down}'.\n    out->write( '${operand.replace(/'/g, "''")}: fewer' ).\n`;
    return `CASE ${operand}.\n${first}  WHEN '${up}'.\n    out->write( 'ok' ).\n  WHEN OTHERS.\n    out->write( '${operand.replace(/'/g, "''")}: more' ).\nENDCASE.`;
  }).join("\n");
  assert.deepEqual(abap(body), { stdout: lines(...cases.map(() => "ok")) });
});

test("CASE: a p result keeps at most 31 digits, also when rounding carries into one more", () => {
  const result = abap(`DATA nines TYPE p LENGTH 16 DECIMALS 0 VALUE '99999999999999999'.
DATA rest TYPE c LENGTH 20 VALUE '0.999999999999999'.
CASE big / p3.
  WHEN '33333333333333333333.33333333333'.
    out->write( 'eleven decimals' ).
ENDCASE.
CASE nines + rest.
  WHEN '100000000000000000'.
    out->write( 'carried' ).
ENDCASE.
s = nines + rest.
out->write( s ).
DATA most TYPE p LENGTH 16 DECIMALS 0 VALUE '9999999999999999999999999999999'.
${caught(`    CASE most + 1.
      WHEN OTHERS.
    ENDCASE.`)}`);
  assert.deepEqual(result, {
    stdout: lines("eleven decimals", "carried", "100000000000000000.0000000000000 ", "CX_SY_ARITHMETIC_OVERFLOW"),
  });
});

test("CASE: a built-in function of a data object is a value of the type of its result", () => {
  const result = abap(`CASE abs( cn ).
  WHEN '1.254'.
    out->write( 'calculated' ).
  WHEN '1.2504'.
    out->write( 'three decimals' ).
ENDCASE.
CASE strlen( s ).
  WHEN '3'.
    out->write( 'three' ).
ENDCASE.
fr = sqrt( c2 ).
CASE sqrt( c2 ).
  WHEN fr.
    out->write( 'f' ).
ENDCASE.
CASE b.
  WHEN abs( neg ).
    out->write( 'one' ).
  WHEN 7 OR strlen( s ).
    out->write( 'strlen' ).
ENDCASE.
${caught(`    CASE abs( imin ).
      WHEN i8.
    ENDCASE.`)}`);
  assert.deepEqual(result, { stdout: lines("three decimals", "three", "f", "strlen", "CX_SY_ARITHMETIC_OVERFLOW") });
});

test("CASE: abs( ) of a text with more than 14 decimals ends the program, as in a comparison", () => {
  const result = abap(`CASE abs( cz ).
  WHEN OTHERS.
    out->write( 'not reached' ).
ENDCASE.`);
  assert.equal(result.stdout, "");
  assert.match(result.failed ?? "", /SYSTEM_TYPE_NOT_ELEMENTARY/);
});

test("CASE: the operand is evaluated first, also when no WHEN compares it", () => {
  const operands: [string, string][] = [
    ["a / z", "CX_SY_ZERODIVIDE"],
    ["sqrt( neg )", "CX_SY_ARG_OUT_OF_DOMAIN"],
    ["abs( imin )", "CX_SY_ARITHMETIC_OVERFLOW"],
    ["s+off(1)", "CX_SY_RANGE_OUT_OF_BOUNDS"],
  ];
  const body = operands.map(([operand]) => caught(`    CASE ${operand}.
      WHEN OTHERS.
        out->write( 'not reached' ).
    ENDCASE.`)).join("\n")
    + "\n" + caught(`    CASE s+off(1).
      WHEN 'a'.
      WHEN OTHERS.
        out->write( 'not reached' ).
    ENDCASE.`)
    + "\n" + caught(`    CASE a / z.
      WHEN sqrt( neg ).
    ENDCASE.`);
  assert.deepEqual(abap(body), {
    stdout: lines(...operands.map(([, cx]) => cx), "CX_SY_RANGE_OUT_OF_BOUNDS", "CX_SY_ZERODIVIDE"),
  });
});

test("CASE: WHEN values are evaluated in order, until one is equal to the operand", () => {
  const result = abap(`CASE a.
  WHEN 1 OR sqrt( neg ).
    out->write( 'the value after the match is not evaluated' ).
ENDCASE.
CASE a.
  WHEN 1.
    out->write( 'nor a later WHEN' ).
  WHEN sqrt( neg ).
ENDCASE.
${caught(`    CASE a.
      WHEN sqrt( neg ) OR 1.
    ENDCASE.`)}
${caught(`    CASE a.
      WHEN 2.
      WHEN sqrt( neg ).
      WHEN OTHERS.
    ENDCASE.`)}`);
  assert.deepEqual(result, {
    stdout: lines("the value after the match is not evaluated", "nor a later WHEN", "CX_SY_ARG_OUT_OF_DOMAIN",
      "CX_SY_ARG_OUT_OF_DOMAIN"),
  });
});

test("CASE: one block runs, and the operand is not evaluated again", () => {
  const result = abap(`CASE k + 1.
  WHEN 2.
    out->write( 'not this' ).
  WHEN 1.
    k = 5.
    out->write( 'one' ).
  WHEN 6.
    out->write( 'not this either' ).
ENDCASE.
DO 2 TIMES.
  CASE sy-index * 10.
    WHEN 10.
      CONTINUE.
    WHEN 20.
      DATA seen TYPE i VALUE 7.
      out->write( seen ).
  ENDCASE.
ENDDO.`);
  assert.deepEqual(result, { stdout: lines("one", 7) });
});

test("CASE: a text value that is no number is the runtime error CONVT_NO_NUMBER, also against an expression", () => {
  const result = abap(`CASE a + 1.
  WHEN text.
ENDCASE.`);
  assert.match(result.failed ?? "", /CONVT_NO_NUMBER/);
});
