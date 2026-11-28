import { test } from "node:test";
import * as assert from "node:assert/strict";
import { syntaxCheck } from "../harness";

// The operands of CASE and WHEN that ABAP is expected to reject (docs/spec/comparison.md, "CASE"): parentheses after
// CASE around a single operand, a calculation or another expression after WHEN, and a value after WHEN without a
// comparison type with the operand of CASE.

const DECLARATIONS = `REPORT zprobe.
CLASS lcl DEFINITION.
  PUBLIC SECTION.
    CLASS-DATA attr TYPE i.
    CLASS-METHODS get IMPORTING p TYPE i OPTIONAL RETURNING VALUE(r) TYPE i.
    CLASS-METHODS str RETURNING VALUE(r) TYPE string.
ENDCLASS.
CLASS lcl IMPLEMENTATION.
  METHOD get.
  ENDMETHOD.
  METHOD str.
  ENDMETHOD.
ENDCLASS.
TYPES ty_strings TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
TYPES: BEGIN OF ty_row,
         f TYPE string,
       END OF ty_row.
DATA a TYPE i.
DATA b TYPE i.
DATA c TYPE c LENGTH 10.
DATA s TYPE string.
DATA x TYPE x LENGTH 4.
DATA f TYPE f.
DATA d TYPE d.
DATA t TYPE t.
DATA u TYPE utclong.
DATA u2 TYPE utclong.
DATA ref TYPE REF TO i.
DATA tab TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
DATA stab TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
DATA rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
FIELD-SYMBOLS <i> TYPE i.
START-OF-SELECTION.
`;

/** The findings without their positions. */
const findings = (body: string) => syntaxCheck("prog", DECLARATIONS + body).map(f => f.replace(/^\d+:\d+: /, ""));
const caseOf = (operand: string, value = "1") => findings(`CASE ${operand}.\n  WHEN ${value}.\nENDCASE.`);

const CASE_PARENTHESES = "Parentheses after CASE only around a calculation, not around a single operand [case_operand]";

const single = ["( a )", "( ( a ) )", "( 1 )", "( -1 )", "( 'x' )", "( `x` )", "( |x| )", "( c+1(2) )", "( ref->* )",
  "( <i> )", "( text-001 )", "( lcl=>attr )", "( sy-index )", "( lcl=>get( ) )", "( lcl=>get( a + 1 ) )",
  "( CONV i( a ) )", "( CONV i( a + 1 ) )", "( VALUE i( ) )", "( COND i( WHEN a = 1 THEN 2 ) )", "( tab[ 1 ] )",
  "( abs( a ) )", "( abs( -1 ) )", "( abs( c+1(2) ) )", "( abs( sy-index ) )", "( abs( ( a ) ) )", "( sign( a ) )",
  "( ceil( f ) )", "( strlen( s ) )", "( strlen( 'a' ) )", "( xstrlen( x ) )", "( numofchar( s ) )",
  "( charlen( s ) )", "( dbmaxlen( s ) )", "( lines( tab ) )", "( lines( stab ) )",
  "( count( val = s sub = 'a' ) )", "( find( val = s sub = 'a' ) )", "( ipow( base = a exp = 2 ) )",
  "( round( val = f dec = 1 ) )", "( nmax( val1 = a val2 = a ) )", "( strlen( c && s ) )",
  "( strlen( condense( s ) ) )", "( count( val = c && s sub = 'a' ) )", "( condense( s ) )",
  "( substring( val = s len = 1 ) )", "( boolc( a = 1 ) )", "( xsdbool( a = 1 ) )", "( c && s )", "( 'a' & 'b' )"];
for (const operand of single) {
  test(`CASE refused: ${operand}`, () => {
    const found = caseOf(operand);
    assert.ok(found.includes(CASE_PARENTHESES), found.join("\n"));
  });
}

const calculated = ["( a + 1 )", "( - 1 )", "( - a )", "( + a )", "- ( a )", "( a ) + 1", "1 + ( a )",
  "( ( a ) + 1 )", "( ( a + 1 ) )", "( ( ( a + 1 ) ) )", "( ( ( a ) ) + 1 )", "( ( a ) ) + 1", "( - ( a ) )",
  "- ( abs( a ) )", "( a ) ** 2", "( a ) MOD ( a )", "lcl=>get( ) + ( a )", "( CONV i( a ) + 1 )",
  "( lcl=>get( ) + 1 )", "( strlen( s ) + 0 )", "( abs( a + 1 ) )", "( abs( ( a + 1 ) ) )", "( abs( - a ) )",
  "( abs( abs( a ) ) )", "( abs( strlen( s ) ) )", "( abs( lcl=>get( ) ) )", "( abs( CONV i( a ) ) )",
  "( abs( COND i( WHEN a = 1 THEN 2 ) ) )", "( abs( tab[ 1 ] ) )", "( abs( ipow( base = a exp = 2 ) ) )",
  "( strlen( lcl=>str( ) ) )", "( strlen( CONV string( c ) ) )", "( strlen( stab[ 1 ] ) )",
  "( lines( VALUE ty_strings( ) ) )", "( count( val = lcl=>str( ) sub = 'a' ) )",
  "( find( val = s sub = 'a' off = a + 1 ) )", "( ipow( base = a + 1 exp = 2 ) )",
  "( ipow( base = lcl=>get( ) exp = 2 ) )", "( ipow( base = abs( a ) exp = 2 ) )",
  "( ipow( base = a exp = a + 1 ) )", "( nmin( val1 = a val2 = CONV i( a ) ) )", "( round( val = f + 1 dec = 1 ) )",
  "abs( ( a + 1 ) )", "abs( ( a ) ) + 1", "a + 1", "- a", "abs( a + 1 )",
  "ipow( base = a exp = 2 )"];
for (const operand of calculated) {
  test(`CASE accepted: ${operand}`, () => {
    assert.deepEqual(caseOf(operand), []);
  });
}

for (const operand of ["( x BIT-AND x )", "( BIT-NOT x )", "( x ) BIT-AND x", "BIT-NOT ( x )", "( ( x BIT-AND x ) )"]) {
  test(`CASE accepted: ${operand}`, () => {
    assert.deepEqual(caseOf(operand, "x"), []);
  });
}

for (const operand of ["s && `a`", "|a|", "condense( s )", "to_upper( s )", "boolc( a = 1 )", "x BIT-AND x",
  "BIT-NOT x", "stab[ 1 ]", "rows[ 1 ]-f"]) {
  test(`CASE accepted: ${operand}`, () => {
    assert.deepEqual(caseOf(operand, "`a`"), []);
  });
}

for (const operand of ["abs( ( a ) )", "( abs( ( a ) ) )"]) {
  test(`CASE refused once: ${operand}`, () => {
    assert.equal(caseOf(operand).length, 1);
  });
}

const refusedValues: [string, string][] = [];
const refuse = (message: string, ...values: string[]) => values.forEach(v => refusedValues.push([v, message]));

refuse("Arithmetic expression not allowed after WHEN", "b + 1", "b - 1", "b * 2", "b / 2", "b ** 2", "b MOD 2",
  "b DIV 2", "- b", "+ b", "- 1", "( b + 1 )", "1 OR b * 2", "b + 1 OR 2", "1 OR 2 OR - b", "lcl=>get( ) + 1",
  "abs( b ) + 1", "lines( tab ) + 1", "CONV i( b ) + 1", "ipow( base = b exp = 2 )", "nmax( val1 = a val2 = b )",
  "nmin( val1 = a val2 = b )", "round( val = f dec = 1 )", "abs( b + 0 )", "abs( - b )", "abs( strlen( s ) )",
  "1 OR abs( b + 0 )", "( abs( strlen( s ) ) )");
refuse("Parentheses not allowed after WHEN", "( b )", "( ( b ) )", "( 1 )", "( lcl=>get( ) )", "( abs( b ) )",
  "( CONV i( b ) )", "2 OR ( b )", "( b ) OR 2", "1 OR ( ( b ) ) OR 3", "( abs( lcl=>get( ) ) )", "( 'a' & 'b' )",
  "( c && s )");
refuse("String expression not allowed after WHEN", "s && `a`", "c && s && `a`", "|a|", "|a{ s }|",
  "`a` OR s && `b`");
refuse("Bit expression not allowed after WHEN", "x BIT-AND x", "x BIT-OR x", "x BIT-XOR x", "BIT-NOT x");
refuse("Table expression not allowed after WHEN", "tab[ 1 ]", "rows[ 1 ]-f", "1 OR tab[ 1 ]");
for (const [value, name] of [["condense( s )", "condense"], ["to_upper( s )", "to_upper"],
  ["substring( val = s off = 1 )", "substring"], ["repeat( val = s occ = 2 )", "repeat"],
  ["cmax( val1 = s val2 = c )", "cmax"], ["concat_lines_of( table = stab )", "concat_lines_of"],
  ["boolc( a = 1 )", "boolc"], ["xsdbool( a = 1 )", "xsdbool"], ["boolx( bool = a = 1 bit = 1 )", "boolx"],
  ["bit-set( 1 )", "bit-set"]]) {
  refuse(`Built-in function "${name}" not allowed after WHEN, only a numeric function`, value);
}
for (const [value, name] of [["abs( lcl=>get( ) )", "abs"], ["abs( tab[ 1 ] )", "abs"], ["abs( CONV i( b ) )", "abs"],
  ["abs( VALUE i( ) )", "abs"], ["abs( ( b ) )", "abs"], ["lines( VALUE ty_strings( ) )", "lines"],
  ["strlen( condense( s ) )", "strlen"], ["strlen( c && s )", "strlen"], ["count( val = s sub = 'a' )", "count"],
  ["find( val = s sub = 'a' )", "find"], ["1 OR abs( lcl=>get( ) )", "abs"]]) {
  refuse(`Built-in function "${name}" not allowed after WHEN, only a function of a data object`, value);
}

for (const [value, message] of refusedValues) {
  test(`WHEN refused: ${value}`, () => {
    assert.deepEqual(caseOf("a", value), [`${message} [when_operand]`]);
  });
}

test("WHEN refused, reported by abaplint: ( c ) && 'a'", () => {
  assert.deepEqual(caseOf("c", "( c ) && 'a'"), ["Parentheses not allowed around an operand of && [check_syntax]"]);
});

const acceptedValues = ["b", "1", "-1", "1 OR -1 OR b", "lcl=>attr", "ref->*", "<i>", "sy-index", "lcl=>get( )",
  "lcl=>get( b + 1 )", "lcl=>get( p = b * 2 )", "abs( b )", "abs( -1 )", "abs( ref->* )", "abs( <i> )",
  "abs( lcl=>attr )", "abs( sy-index )", "sign( f )", "ceil( f )", "sqrt( b )", "strlen( 'a' )", "strlen( `a` )",
  "strlen( s )", "strlen( c+1(2) )", "strlen( text-001 )", "xstrlen( x )", "numofchar( s )", "charlen( s )",
  "lines( tab )", "CONV i( b + 1 )", "COND i( WHEN a = 1 THEN b + 1 )"];
for (const value of acceptedValues) {
  test(`WHEN accepted: ${value}`, () => {
    assert.deepEqual(caseOf("a", value), []);
  });
}

for (const value of ["'a' & 'b'", "CONV string( s && `a` )", "lcl=>get( strlen( s && `a` ) )", "strlen( s )"]) {
  test(`WHEN accepted for a string: ${value}`, () => {
    assert.deepEqual(caseOf("s", value), []);
  });
}

const NO_TYPE = "Incompatible types for comparison [comparison_type]";

for (const [operand, value] of [["d", "t"], ["t", "c OR d"], ["u", "a"], ["a", "u"]]) {
  test(`CASE ${operand}, WHEN ${value}: no comparison type`, () => {
    assert.deepEqual(caseOf(operand, value), [NO_TYPE]);
  });
}

// an arithmetic expression after CASE is calculated on its own
for (const [operand, value] of [["u", "c OR u2 OR 'x'"], ["d", "c"], ["a + 1", "d OR t OR c"], ["a + 1", "u"]]) {
  test(`CASE ${operand}, WHEN ${value}: accepted`, () => {
    assert.deepEqual(caseOf(operand, value), []);
  });
}

test("the operand of the innermost CASE counts", () => {
  const found = syntaxCheck("prog", `${DECLARATIONS}CASE d.
  WHEN d.
    CASE t.
      WHEN t.
    ENDCASE.
  WHEN t.
ENDCASE.`);
  const row = DECLARATIONS.split("\n").length + 5;
  assert.equal(found.length, 1, found.join("\n"));
  assert.match(found[0], new RegExp(`^${row}:\\d+: Incompatible types`));
});
