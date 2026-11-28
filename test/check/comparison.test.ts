import { test } from "node:test";
import * as assert from "node:assert/strict";
import { syntaxCheck } from "../harness";

// Comparisons that ABAP is expected to reject (docs/spec/comparison.md, "Syntax errors"): two operands without a
// comparison type, an arithmetic expression against a non-numeric operand, and parentheses around a data object as
// the argument of a numeric function outside a calculation.

const DECLARATIONS = `REPORT zprobe.
CLASS lcl DEFINITION.
  PUBLIC SECTION.
    CLASS-DATA attr TYPE i.
    CLASS-METHODS get RETURNING VALUE(r) TYPE i.
ENDCLASS.
CLASS lcl IMPLEMENTATION.
  METHOD get.
  ENDMETHOD.
ENDCLASS.
TYPES ty_date TYPE d.
CONSTANTS kt TYPE t VALUE '120000'.
DATA: BEGIN OF st,
        d TYPE d,
        t TYPE t,
      END OF st.
DATA c TYPE c LENGTH 30.
DATA s TYPE string.
DATA n TYPE n LENGTH 4.
DATA d TYPE d.
DATA t TYPE t.
DATA x TYPE x LENGTH 4.
DATA xs TYPE xstring.
DATA i TYPE i.
DATA j TYPE i.
DATA i8 TYPE int8.
DATA p TYPE p LENGTH 8 DECIMALS 2.
DATA f TYPE f.
DATA d34 TYPE decfloat34.
DATA u TYPE utclong.
DATA u2 TYPE utclong.
DATA ref TYPE REF TO i.
DATA tab TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
FIELD-SYMBOLS <t> TYPE t.
FIELD-SYMBOLS <i> TYPE i.
START-OF-SELECTION.
`;

/** The findings without their positions. */
const findings = (body: string) => syntaxCheck("prog", DECLARATIONS + body).map(f => f.replace(/^\d+:\d+: /, ""));
const condition = (text: string) => findings(`IF ${text}.\nENDIF.`);

const NO_TYPE = "Incompatible types for comparison [comparison_type]";

const withoutType = ["d = t", "t < d", "d EQ t", "d BETWEEN t AND d", "d NOT BETWEEN d AND t", "u = i", "u = i8",
  "u = n", "u = x", "u = xs", "u = d", "u = t", "u = p", "u = f", "u = d34", "u = 1", "i = u", "u BETWEEN i AND i",
  "u BETWEEN u2 AND i",
  // where the type comes from: a constant, a field symbol, a component, a subfield, CONV, a function
  "d = kt", "d = <t>", "st-d = st-t", "st-d = t", "u = d+0(4)", "u = abs( i )", "u = strlen( s )",
  "d = CONV t( c )", "t = CONV ty_date( c )", "d = ( t )", "u = sy-index"];
for (const text of withoutType) {
  test(`no comparison type: ${text}`, () => {
    assert.deepEqual(condition(text), [NO_TYPE]);
  });
}

const withType = ["u = u2", "u = c", "u = s", "s = u", "u = 'x'", "u = `x`", "u BETWEEN c AND u2", "d = d", "t = c",
  "d = c", "t = n", "i = d", "d CO '0123456789'", "u IS INITIAL", "d = t+0(2)", "d = sy-datum", "t = sy-uzeit",
  "d = CONV d( t )", "u = |x|", "u = c && s", "u = utclong_current( )"];
for (const text of withType) {
  test(`a comparison type: ${text}`, () => {
    assert.deepEqual(condition(text), []);
  });
}

test("no comparison type: in CHECK, WHILE, ASSERT and xsdbool( )", () => {
  assert.deepEqual(findings("CHECK d = t.\nWHILE d = t.\nENDWHILE.\nASSERT d = t.\nc = xsdbool( d = t )."),
    [NO_TYPE, NO_TYPE, NO_TYPE, NO_TYPE]);
});

const calculations = ["ipow( base = i exp = 2 )", "nmax( val1 = i val2 = 1 )", "nmin( val1 = i val2 = 1 )",
  "round( val = f dec = 1 )", "abs( i + 1 )", "abs( - i )", "sign( i + 1 )", "ceil( f + 1 )", "floor( abs( f ) )",
  "trunc( f + 1 )", "frac( f + 1 )", "exp( f + 1 )", "sqrt( f + 1 )", "abs( strlen( s ) )", "abs( numofchar( s ) )",
  "( abs( i + 1 ) )"];
for (const expression of calculations) {
  for (const text of [`c = ${expression}`, `${expression} = d`]) {
    test(`a calculation against a non-numeric operand: ${text}`, () => {
      const found = condition(text);
      assert.equal(found.length, 1, found.join("\n"));
      assert.match(found[0], /cannot be compared with non-numeric operand .* \[comparison_calculation\]$/);
    });
  }
}

// an arithmetic expression as one bound against a non-numeric other bound, which abaplint does not pair up
const between = ["1 BETWEEN c AND i + 1", "i BETWEEN d AND i + 1", "1 BETWEEN i + 1 AND c"];
for (const text of between) {
  test(`a calculation in BETWEEN: ${text}`, () => {
    const found = condition(text);
    assert.equal(found.length, 1, found.join("\n"));
    assert.match(found[0], /cannot be compared with non-numeric operand .* \[comparison_calculation\]$/);
  });
}

// abaplint reports the plain forms itself
for (const text of ["c = i + 1", "- i = s", "( i * 2 ) = x", "c BETWEEN 1 AND i + 1", "i + 1 BETWEEN 1 AND c"]) {
  test(`a calculation against a non-numeric operand, reported by abaplint: ${text}`, () => {
    const found = condition(text);
    assert.equal(found.length, 1, found.join("\n"));
    assert.match(found[0], /cannot be compared with non-numeric operand .* \[check_syntax\]$/);
  });
}

test("a utclong against a calculation", () => {
  assert.deepEqual(condition("u = i + 1"),
    ["A time stamp of type utclong cannot be compared with an arithmetic expression [comparison_calculation]"]);
});

const numeric = ["c = abs( i )", "c = sign( i )", "c = sqrt( f )", "c = exp( f )", "c = strlen( s )",
  "c = numofchar( s )", "( c ) = i", "c = ( i )", "( c ) = c", "i = ipow( base = i exp = 2 )",
  "i BETWEEN i + 1 AND abs( i )", "c BETWEEN 1 AND abs( i )", "+ c = i + 1"];
for (const text of numeric) {
  test(`comparison accepted: ${text}`, () => {
    assert.deepEqual(condition(text), []);
  });
}

const parentheses = (name: string) =>
  `Parentheses around the argument of "${name}" are only allowed in a calculation [argument_parentheses]`;

const inParentheses = ["abs( ( i ) ) = 1", "i = abs( ( i ) )", "abs( ( ( i ) ) ) = 1", "abs( ( 1 ) ) = 1",
  "abs( ( -1 ) ) = 1", "abs( ( sy-index ) ) = 1", "abs( ( c+1(2) ) ) = 1", "abs( ( ref->* ) ) = 1",
  "abs( ( <i> ) ) = 1", "abs( ( lcl=>attr ) ) = 1", "sign( ( i ) ) = 1", "sqrt( ( f ) ) = 1", "( abs( ( i ) ) ) = 1",
  "abs( ( i ) ) = j", "abs( ( i ) ) = ( j )", "abs( ( i ) ) = abs( j )", "abs( ( i ) ) = strlen( s )",
  "abs( ( i ) ) = lines( tab )", "abs( ( i ) ) = lcl=>get( )", "abs( ( i ) ) = 1 AND i + 1 = 2",
  "NOT abs( ( i ) ) = 1", "i BETWEEN abs( ( i ) ) AND 2", "abs( ( i ) ) BETWEEN 1 AND 2", "abs( ( i ) ) IS INITIAL"];
for (const text of inParentheses) {
  test(`parentheses refused: ${text}`, () => {
    const name = /(sign|sqrt)\(/.exec(text)?.[1] ?? "abs";
    assert.deepEqual(condition(text), [parentheses(name)]);
  });
}

const inCalculation = ["abs( ( i + 1 ) ) = 1", "abs( ( ( i ) + 1 ) ) = 1", "abs( ( - i ) ) = 1",
  "abs( ( lcl=>get( ) ) ) = 1", "abs( ( abs( i ) ) ) = 1", "abs( ( strlen( s ) ) ) = 1", "abs( ( CONV i( i ) ) ) = 1",
  "abs( ( tab[ 1 ] ) ) = 1", "abs( abs( ( i ) ) ) = 1", "abs( ( i ) ) + 1 = 1", "1 + abs( ( i ) ) = 1",
  "( abs( ( i ) ) ) + 1 = 1", "abs( ( i ) ) = j + 1", "abs( ( i ) ) = - j", "abs( ( i ) ) = ( abs( j ) + 1 )",
  "abs( ( i ) ) = abs( ( j + 1 ) )", "abs( ( i ) ) = abs( lcl=>get( ) )", "abs( ( i ) ) = strlen( s && s )",
  "abs( ( i ) ) = ipow( base = j exp = 2 )", "abs( ( i ) ) = find( val = s sub = 'a' )",
  "abs( ( i ) ) BETWEEN 1 AND j + 1", "ipow( base = ( i ) exp = 2 ) = 1", "lcl=>get( ) = 1 AND i = 1"];
for (const text of inCalculation) {
  test(`parentheses in a calculation: ${text}`, () => {
    assert.deepEqual(condition(text), []);
  });
}

for (const where of ["table_line = abs( ( i ) )", "table_line BETWEEN abs( ( i ) ) AND j + 1"]) {
  test(`parentheses refused in a WHERE condition: ${where}`, () => {
    assert.deepEqual(findings(`LOOP AT tab INTO j WHERE ${where}.\nENDLOOP.`), [parentheses("abs")]);
  });
}

for (const where of ["table_line = ( i )", "table_line = abs( ( i + 1 ) )", "table_line = abs( ( i ) ) + 1"]) {
  test(`parentheses accepted in a WHERE condition: ${where}`, () => {
    assert.deepEqual(findings(`LOOP AT tab INTO j WHERE ${where}.\nENDLOOP.`), []);
  });
}

for (const statement of ["i = abs( ( i ) ).", "i = ( abs( ( i ) ) ).", "i = abs( ( i ) ) + 1.",
  "s = |{ abs( ( i ) ) }|.", "APPEND abs( ( i ) ) TO tab."]) {
  test(`parentheses accepted outside a comparison: ${statement}`, () => {
    assert.deepEqual(findings(statement), []);
  });
}

test("a method of the same name hides the built-in function", () => {
  const source = `REPORT zprobe.
CLASS lcl DEFINITION.
  PUBLIC SECTION.
    CLASS-METHODS abs IMPORTING p TYPE i RETURNING VALUE(r) TYPE i.
    CLASS-METHODS run.
ENDCLASS.
CLASS lcl IMPLEMENTATION.
  METHOD abs.
  ENDMETHOD.
  METHOD run.
    DATA a TYPE i.
    IF abs( ( a ) ) = 1.
    ENDIF.
    CASE a.
      WHEN abs( a + 1 ).
    ENDCASE.
  ENDMETHOD.
ENDCLASS.`;
  assert.deepEqual(syntaxCheck("prog", source), []);
});
