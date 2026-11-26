import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classrun, run } from "./harness";

// Built-in functions as operands of a comparison (docs/spec/comparison.md, "Built-in functions as operands"):
// abs( ), sqrt( ) and strlen( ) of a single data object are values of the type of their result, compared as data
// objects are. ipow( ) and a function of an expression are arithmetic expressions.

const DECLARATIONS = `DATA i TYPE i VALUE -7.
DATA two TYPE i VALUE 2.
DATA neg TYPE i VALUE -1.
DATA zero TYPE i.
DATA imin TYPE i VALUE '-2147483648'.
DATA i8 TYPE int8.
DATA p TYPE p LENGTH 8 DECIMALS 2 VALUE '-1.23'.
DATA c TYPE c LENGTH 10 VALUE '-1.25'.
DATA c3 TYPE c LENGTH 10 VALUE '-1.250'.
DATA bad TYPE c LENGTH 3 VALUE 'abc'.
DATA s TYPE string VALUE \`abc\`.
DATA x TYPE x LENGTH 4 VALUE 'FFFFFFFF'.
DATA d TYPE d VALUE '20240101'.
DATA df16 TYPE decfloat16 VALUE 2.
DATA root TYPE decfloat34 VALUE '1.414213562373095048801688724209698'.
DATA digits32 TYPE string VALUE \`12345678901234567890123456789012\`.
DATA digits35 TYPE string VALUE \`12345678901234567890.123456789012345\`.
DATA decimals15 TYPE string VALUE \`1.123456789012345\`.
DATA zeros15 TYPE string VALUE \`0.000000000000000\`.
DATA u TYPE utclong.
`;

const cells: [string, "T" | "F"][] = [
  // strlen( ) is an i
  ["strlen( s ) = '3'", "T"],
  ["strlen( s ) = '3.4'", "T"],
  ["strlen( s+1(2) ) = '2'", "T"],
  // a function on both sides
  ["strlen( s ) = strlen( 'abc' )", "T"],
  ["abs( i ) = abs( p )", "F"],
  ["abs( i ) > abs( p )", "T"],
  // abs( ) has the type of its argument: i for i, d, t and x, p for p and for text
  ["abs( i ) = 7", "T"],
  ["abs( sy-index ) = 0", "T"],
  ["abs( x ) = 1", "T"],
  ["abs( d ) BETWEEN d AND d", "T"],
  // a p keeps its decimals: the text it is compared with is rounded to them
  ["abs( p ) = '1.234'", "T"],
  ["abs( p ) = `1.23`", "T"],
  // a p of a text has the decimals of the number in the text
  ["abs( c ) = '1.2504'", "T"],
  ["abs( c ) = '1.3'", "F"],
  ["abs( c3 ) = '1.254'", "F"],
  // and 31 digits in all
  ["abs( digits35 ) = '12345678901234567890.123456789014'", "T"],
  // sqrt( ) is an f, a decfloat34 for a decimal floating point argument
  ["sqrt( two ) = root", "F"],
  ["sqrt( two ) = '1.4142135623730951'", "T"],
  ["sqrt( df16 ) = root", "T"],
  // with an arithmetic expression on a side, a function is calculated in the calculation type of the comparison
  ["sqrt( two ) = root + 0", "T"],
  ["abs( imin ) > i8 + 0", "T"],
  ["abs( c ) = zero + 1", "F"],
  ["abs( decimals15 ) > zero + 0", "T"],
  ["strlen( s ) + 0 = 3", "T"],
  ["strlen( s ) = zero + 3", "T"],
  // a function of an expression is an arithmetic expression itself, and so is ipow( )
  ["abs( imin + 0 ) > i8", "T"],
  ["abs( abs( imin ) ) > i8", "T"],
  ["ipow( base = two exp = 3 ) = 8", "T"],
  ["ipow( base = two exp = 31 ) = i8", "F"],
  ["ipow( base = two exp = 31 ) > i8 + 0", "T"],
  // BETWEEN
  ["strlen( s ) BETWEEN 3 AND 4", "T"],
  ["two BETWEEN abs( p ) AND strlen( s )", "T"],
  ["abs( i ) NOT BETWEEN 1 AND 6", "T"],
  ["abs( imin ) BETWEEN i8 AND i8 + 3000000000", "T"],
  // a function is evaluated only when its comparison is
  ["zero = 0 OR abs( imin ) = 0", "T"],
  ["zero = 1 AND sqrt( neg ) = 0", "F"],
  ["abs( i ) BETWEEN 8 AND abs( imin )", "F"],
];

test("function operands: the true and false cells, in one program", () => {
  const body = cells.map(([condition]) => `IF ${condition}.\n  out->write( 'T' ).\nELSE.\n  out->write( 'F' ).\nENDIF.`);
  const result = run("clas", classrun(DECLARATIONS + body.join("\n")));
  assert.equal(result.refused, undefined, result.refused);
  const lines = (result.stdout ?? "").split("\n");
  const differences = cells.flatMap(([condition, want], n) =>
    lines[n] === want ? [] : [`${condition}: got ${JSON.stringify(lines[n])}, want ${want}`]);
  assert.deepEqual(differences, []);
  assert.equal(result.failed, undefined);
});

const errors: [string, RegExp][] = [
  // without an arithmetic expression, the function is calculated in the type of its argument
  ["abs( imin ) = 0", /exception CX_SY_ARITHMETIC_OVERFLOW not caught/],
  ["abs( imin ) = i8", /exception CX_SY_ARITHMETIC_OVERFLOW not caught/],
  ["abs( bad ) = 0", /exception CX_SY_CONVERSION_NO_NUMBER not caught/],
  ["sqrt( neg ) = 0", /exception CX_SY_ARG_OUT_OF_DOMAIN not caught/],
  ["abs( digits32 ) > 0", /exception CX_SY_CONVERSION_OVERFLOW not caught/],
  // the operands are evaluated from the left, and both before they are compared
  ["abs( bad ) = sqrt( neg )", /exception CX_SY_CONVERSION_NO_NUMBER not caught/],
  ["sqrt( neg ) = abs( bad )", /exception CX_SY_ARG_OUT_OF_DOMAIN not caught/],
  ["bad = abs( imin )", /exception CX_SY_ARITHMETIC_OVERFLOW not caught/],
  ["two BETWEEN abs( imin ) AND 5", /exception CX_SY_ARITHMETIC_OVERFLOW not caught/],
  ["ipow( base = two exp = 31 ) > 0", /exception CX_SY_ARITHMETIC_OVERFLOW not caught/],
  // a p has at most 14 decimals, so abs( ) of a text with more of them has no type
  ["abs( decimals15 ) > 0", /SYSTEM_TYPE_NOT_ELEMENTARY/],
  ["abs( zeros15 ) = 0", /SYSTEM_TYPE_NOT_ELEMENTARY/],
];
for (const [condition, error] of errors) {
  test(`function operands: ${condition} ends the program`, () => {
    const result = run("clas", classrun(`${DECLARATIONS}out->write( 'before' ).\nIF ${condition}.\nENDIF.\nout->write( 'after' ).`));
    assert.equal(result.refused, undefined, result.refused);
    assert.equal(result.stdout, "before\n");
    assert.match(result.failed ?? "", error);
  });
}

test("function operands: TRY catches the exception of a function, not the runtime error", () => {
  const source = `${DECLARATIONS}TRY.
  IF abs( imin ) = 0.
  ENDIF.
CATCH cx_sy_arithmetic_overflow.
  out->write( 'overflow' ).
ENDTRY.
TRY.
  IF zero = 1 OR sqrt( neg ) = 0.
  ENDIF.
CATCH cx_sy_arg_out_of_domain.
  out->write( 'domain' ).
ENDTRY.
TRY.
  IF abs( decimals15 ) > 0.
  ENDIF.
CATCH cx_root.
  out->write( 'not caught here' ).
ENDTRY.`;
  const result = run("clas", classrun(source));
  assert.equal(result.refused, undefined, result.refused);
  assert.equal(result.stdout, "overflow\ndomain\n");
  assert.match(result.failed ?? "", /SYSTEM_TYPE_NOT_ELEMENTARY/);
});

const refusals: [string, RegExp][] = [
  // an arithmetic expression cannot be compared with a non-numeric operand
  ["abs( i ) + 0 = bad", /syntax check/],
  ["abs( i + 0 ) = bad", /syntax check/],
  ["bad = abs( - i )", /syntax check/],
  ["abs( strlen( s ) ) = bad", /syntax check/],
  ["ipow( base = two exp = 2 ) = bad", /syntax check/],
  ["bad BETWEEN abs( i ) AND abs( i + 0 )", /syntax check/],
  ["abs( u ) = 1", /utclong|syntax check/],
  ["sqrt( u ) = 1", /utclong|syntax check/],
  ["strlen( s ) = u", /syntax check/],
  ["abs( i ) = u", /syntax check/],
  // not compiled yet
  ["boolc( two = 2 ) = 'X'", /only a literal, a variable or a subfield|syntax check/],
  ["xsdbool( two = 2 ) = 'X'", /only a literal, a variable or a subfield|syntax check/],
];
for (const [condition, refused] of refusals) {
  test(`function operands refused: ${condition}`, () => {
    const result = run("clas", classrun(`${DECLARATIONS}IF ${condition}.\nENDIF.`));
    assert.ok(result.refused !== undefined, `built, stdout ${JSON.stringify(result.stdout)}`);
    assert.match(result.refused, refused);
  });
}
