import { test } from "node:test";
import * as assert from "node:assert/strict";
import { abapgit, classrun, doma, dtel, run } from "./harness";

// Reports: output as open-abap-gui's list processor lays it out (open-steamgate is the reference for WRITE).
const reports: [string, string, string][] = [
  ["hello world", "REPORT zprobe.\nWRITE 'Hello, World!'.", "Hello, World!\n"],
  ["no standard page heading changes nothing without TOP-OF-PAGE", "REPORT zprobe NO STANDARD PAGE HEADING.\nWRITE 'a'.", "a\n"],
  ["gap of one blank, WRITE / starts a line", "REPORT zprobe.\nWRITE 'it''s'. WRITE `str`. WRITE / 'x'. WRITE 'y'.", "it's str\nx y\n"],
  ["WRITE / as the first output starts no empty line", "REPORT zprobe.\nWRITE / 'a'. WRITE / 'b'.", "a\nb\n"],
  ["explicit START-OF-SELECTION", "REPORT zprobe.\nSTART-OF-SELECTION.\n  WRITE 'a'.", "a\n"],
  ["no wrap at LINE-SIZE", "REPORT zprobe LINE-SIZE 10.\nWRITE 'Hello'. WRITE 'World'.", "Hello World\n"],
  ["no wrap at the default width", `REPORT zprobe.\nWRITE '${"x".repeat(100)}'. WRITE '${"y".repeat(100)}'.`, `${"x".repeat(100)} ${"y".repeat(100)}\n`],
  ["characters outside ASCII count one column each", "REPORT zprobe.\nWRITE 'Grüße'. WRITE 'x'.", "Grüße x\n"],
  ["empty program writes nothing", "REPORT zprobe.", ""],
  ["a text field literal has its full length, blanks included", "REPORT zprobe.\nWRITE 'a '. WRITE 'b'.", "a  b\n"],
  ["'' is one blank", "REPORT zprobe.\nWRITE ''. WRITE 'b'.", "  b\n"],
  ["an empty string at the start of a line still gets the gap", "REPORT zprobe.\nWRITE ``. WRITE 'b'.", " b\n"],
  ["a line of blanks only is not output", "REPORT zprobe.\nWRITE / ''. WRITE / 'x'.", "x\n"],
];
for (const [name, source, stdout] of reports) {
  test(`report: ${name}`, () => {
    assert.deepEqual(run("prog", source), { stdout });
  });
}

// WRITE of variables and number literals, formatted by the rules of docs/spec/write.md. Without a user setup the
// settings are the defaults: 1.234.567,89 and DD.MM.YYYY. The first case is open-steamgate's
// ANOMALY-2026-10-17-list-integer-width: an i takes 11 columns.
const US = { users: [{ user: "alice", decimalNotation: "X", dateFormat: "2" }] };
const writes: [string, string, string, object?][] = [
  ["i in 11 columns, right-aligned", "DATA i TYPE i VALUE 6.\nWRITE i.", "         6\n"],
  ["a number literal is an i", "WRITE 1000. WRITE -5.", "     1.000           5-\n"],
  // p LENGTH 8 takes 16 columns, p LENGTH 16 takes 32; no WRITE / before a number, which would be a position
  ["a number literal beyond i is a p of length 8 for up to 15 digits", `WRITE / '|'. WRITE 3000000000. WRITE '|'.
WRITE / '|'. WRITE -2147483649. WRITE '|'.
WRITE / '|'. WRITE 000000000000002147483648. WRITE '|'.
WRITE / '|'. WRITE -999999999999999. WRITE '|'.`,
    "|   3.000.000.000  |\n|   2.147.483.649- |\n|   2.147.483.648  |\n| 999999999999999- |\n"],
  ["a number literal of 16 to 31 digits is a p of length 16", `WRITE / '|'. WRITE 1000000000000000. WRITE '|'.
WRITE / '|'. WRITE -1000000000000000. WRITE '|'.
WRITE / '|'. WRITE 1234567890123456789012345678901. WRITE '|'.`,
    "|           1.000.000.000.000.000  |\n|           1.000.000.000.000.000- |\n| 1234567890123456789012345678901  |\n"],
  ["p with separators, d in the date format", "DATA p TYPE p LENGTH 8 DECIMALS 2 VALUE '-1234.5'.\nDATA d TYPE d VALUE '20240229'.\nWRITE: p, d.",
    "        1.234,50- 29022024\n"],
  ["f in scientific notation, decfloat without its scale", "DATA f TYPE f VALUE '0.1'.\nDATA x TYPE decfloat34 VALUE '-1.50'.\nWRITE / f. WRITE / x.",
    "  1,0000000000000001E-01\n" + " ".repeat(42) + "-1,5\n"],
  ["utclong in 30 columns", "DATA u TYPE utclong.\nDATA s TYPE string VALUE `2024-02-29T12:34:56`.\nu = s.\nWRITE u. WRITE 'end'.",
    "29.02.2024 12:34:56,0000000    end\n"],
  ["n, x, c and t as they are", "DATA n TYPE n LENGTH 4 VALUE '12'.\nDATA x TYPE x LENGTH 2 VALUE 'AB01'.\nDATA c TYPE c LENGTH 4 VALUE 'ab'.\nDATA t TYPE t VALUE '123456'.\nWRITE: n, x, c, t, '|'.",
    "0012 AB01 ab   123456 |\n"],
  ["user setup: p and d", "DATA p TYPE p LENGTH 8 DECIMALS 2 VALUE '-1234.5'.\nDATA d TYPE d VALUE '20240229'.\nWRITE: p, d.",
    "        1,234.50- 02292024\n", US],
  ["user setup: utclong", "DATA u TYPE utclong.\nDATA s TYPE string VALUE `2024-02-29T12:34:56`.\nu = s.\nWRITE u. WRITE 'end'.",
    "02/29/2024 12:34:56.0000000    end\n", US],
  ["a character outside the Basic Multilingual Plane takes two code units", "DATA c4 TYPE c LENGTH 4 VALUE '\u{1F600}a'.\nWRITE c4. WRITE 'x'.",
    "\u{1F600}a  x\n"],
  ["a c field cut between the two code units of a character", "DATA s TYPE string VALUE `\u{1F600}`.\nDATA c1 TYPE c LENGTH 1.\nc1 = s.\nWRITE c1. WRITE 'z'. WRITE / s. WRITE 'y'.",
    "� z\n\u{1F600} y\n"],
  ["user setup: i","DATA i TYPE i VALUE -1234567.\nWRITE i.", " 1,234,567-\n", US],
];
for (const [name, body, stdout, userSetup] of writes) {
  test(`report WRITE: ${name}`, () => {
    assert.deepEqual(run("prog", "REPORT zprobe.\n" + body, userSetup), { stdout });
  });
}

test("a user setup the runtime cannot use ends the program before it runs", () => {
  const result = run("prog", "REPORT zprobe.\nWRITE 'a'.", { users: [{ user: "a", dateFormat: "A" }] });
  assert.equal(result.stdout, "");
  assert.match(result.rejected ?? "", /date format A is not supported yet/);
});

// b and s come from DDIC INT1 and INT2. A data element, typed directly or through a domain, formats as its built-in
// type when it has the same output length (3 for INT1, 6 for INT2) and no conversion exit; a domain's sign flag
// does not change the output.
const DDIC = {
  ...dtel("ZBYTE", "<DATATYPE>INT1</DATATYPE><LENG>000003</LENG><OUTPUTLEN>000003</OUTPUTLEN>"),
  ...dtel("ZSHORT", "<DATATYPE>INT2</DATATYPE><LENG>000005</LENG><OUTPUTLEN>000006</OUTPUTLEN>"),
  ...doma("ZSHORT_NOSIGN", "<DATATYPE>INT2</DATATYPE><LENG>000005</LENG><OUTPUTLEN>000006</OUTPUTLEN>"),
  ...dtel("ZSHORT_DOM", "<DOMNAME>ZSHORT_NOSIGN</DOMNAME><REFKIND>D</REFKIND>"),
  ...dtel("ZINT_WIDE", "<DATATYPE>INT4</DATATYPE><LENG>000010</LENG><OUTPUTLEN>000015</OUTPUTLEN>"),
  ...dtel("ZINT_EXIT", "<DATATYPE>INT4</DATATYPE><LENG>000010</LENG><OUTPUTLEN>000011</OUTPUTLEN><CONVEXIT>ZZZZ</CONVEXIT>"),
  ...dtel("ZINT", "<DATATYPE>INT4</DATATYPE><LENG>000010</LENG><OUTPUTLEN>000011</OUTPUTLEN>"),
};
const ddicWrites: [string, string, string][] = [
  ["b and s from data elements", "DATA s TYPE zshort VALUE -1234.\nDATA b TYPE zbyte VALUE 7.\nWRITE: s, b, '|'.", "1.234-  7  |\n"],
  ["s through a domain without sign flag", "DATA s TYPE zshort_dom VALUE -1234.\nWRITE s.", "1.234-\n"],
  ["b and s at their limits", "DATA s TYPE zshort VALUE 32767.\nDATA b TYPE zbyte VALUE 255.\nWRITE: / s, / b.", "32767\n255\n"],
  ["an i data element with output length 11", "DATA i TYPE zint VALUE 6.\nWRITE i.", "         6\n"],
  ["moves into b and s follow the conversion rules", "DATA s TYPE zshort.\nDATA b TYPE zbyte.\nDATA i TYPE i VALUE -300.\ns = i.\nb = '200'.\nWRITE: s, b.", "  300- 200\n"],
];
for (const [name, body, stdout] of ddicWrites) {
  test(`report WRITE DDIC: ${name}`, () => {
    assert.deepEqual(run("prog", "REPORT zprobe.\n" + body, undefined, DDIC), { stdout });
  });
}

test("a move out of the range of b is an overflow", () => {
  const result = run("prog", "REPORT zprobe.\nDATA b TYPE zbyte.\nb = 256.\nWRITE 'after'.", undefined, DDIC);
  assert.equal(result.stdout, "");
  assert.match(result.failed ?? "", /CX_SY_CONVERSION_OVERFLOW/);
});

test("classrun: out->write of b and s converts to string", () => {
  assert.deepEqual(run("clas", classrun("DATA s TYPE zshort VALUE -5. DATA b TYPE zbyte VALUE 200. out->write( s ). out->write( b )."), undefined, DDIC),
    { stdout: "5-\n200 \n" });
});

const ddicRefusals: [string, string, RegExp][] = [
  ["a data element with another output length", "DATA i TYPE zint_wide.\nWRITE i.", /data element ZINT_WIDE has output length 15/],
  ["a data element with a conversion exit", "DATA i TYPE zint_exit.\nWRITE i.", /conversion exit ZZZZ/],
  ["a type from the system fields", "DATA d TYPE sy-datum.\nWRITE d.", /WRITE of d: typed with sy-datum/],
  ["LIKE", "DATA a TYPE i.\nDATA b LIKE a.\nWRITE b.", /WRITE of b: typed with LIKE/],
];
for (const [name, body, refused] of ddicRefusals) {
  test(`report WRITE DDIC refused: ${name}`, () => {
    assert.match(run("prog", "REPORT zprobe.\n" + body, undefined, DDIC).refused ?? "", refused);
  });
}

const reportRefusals: [string, string, RegExp][] = [
  ["DATA of a reference", "REPORT zprobe.\nDATA x TYPE REF TO object.", /:2:1: x: type .* is not compiled yet/],
  ["inline declaration of a calculation", "REPORT zprobe.\nDATA x TYPE i.\nDATA(y) = x + 1.", /:3:1: .*only variable = literal, variable or arithmetic expression/],
  ["utclong operand", "REPORT zprobe.\nDATA u TYPE utclong.\nDATA x TYPE i.\nx = u + 1.", /"u" is a time stamp of type utclong, it cannot be used in a calculation \[check_syntax\]/],
  ["abs( ) without its argument", "REPORT zprobe.\nDATA x TYPE i.\nx = abs( ).", /syntax check/],
  ["ipow( ) without exp", "REPORT zprobe.\nDATA x TYPE i.\nx = ipow( base = 2 ).", /syntax check/],
  ["ipow( ) with an unknown argument", "REPORT zprobe.\nDATA x TYPE i.\nx = ipow( base = 2 exp = 2 foo = 1 ).", /syntax check/],
  ["strlen( ) with two arguments", "REPORT zprobe.\nDATA x TYPE i.\nx = strlen( a = `a` b = `b` ).", /syntax check/],
  ["a method call in an expression","REPORT zprobe.\nDATA x TYPE i.\nx = cl_abap_random=>create( )->int( ) + 1.", /not compiled|syntax check/],
  ["WRITE of an expression", "REPORT zprobe.\nDATA x TYPE i.\nWRITE x + 1.", /WRITE of x \+ 1: only a literal, a variable or a subfield/],
  ["WRITE addition", "REPORT zprobe.\nWRITE 'a' COLOR 1.", /no additions/],
  ["WRITE of a constant", "REPORT zprobe.\nCONSTANTS c TYPE string VALUE `a`.\nWRITE c.", /statement Constant is not compiled yet/],
  ["other events", "REPORT zprobe.\nINITIALIZATION.\nSTART-OF-SELECTION.\nWRITE 'a'.", /statement Initialization is not compiled yet/],
  ["TOP-OF-PAGE", "REPORT zprobe.\nTOP-OF-PAGE.\nWRITE 'h'.\nSTART-OF-SELECTION.\nWRITE 'a'.", /statement TopOfPage is not compiled yet/],
  ["REPORT addition", "REPORT zprobe MESSAGE-ID zz.\nWRITE 'a'.", /REPORT addition MESSAGE-ID/],
  ["syntax error", "REPORT zprobe.\nWRITE foo.", /do not pass the syntax check[\s\S]*"foo" not found/],
  // checked as abaplint/transpiler checks its input: an unknown type is an error, not a void type
  ["unknown type", "REPORT zprobe.\nDATA v TYPE matnr.", /do not pass the syntax check[\s\S]*MATNR not found[\s\S]*\[unknown_types\]/],
  ["WHEN OTHERS not last", "REPORT zprobe.\nDATA i TYPE i.\nCASE i.\n  WHEN OTHERS.\n  WHEN 1.\nENDCASE.", /\[when_others_last\]/],
];
for (const [name, source, refused] of reportRefusals) {
  test(`report refused: ${name}`, () => {
    const result = run("prog", source);
    assert.ok(result.refused !== undefined, `built, stdout ${JSON.stringify(result.stdout)}`);
    assert.match(result.refused, refused);
  });
}

// Arithmetic: the calculation type table of docs/spec/calculation.md. The runtime's own tests run all its cells;
// these check that the compiler builds the expression the source means.
const calculations: [string, string, string][] = [
  ["i division rounds half away from zero", "DATA a TYPE i VALUE 7.\nDATA r TYPE i.\nr = a / 2. out->write( r ).\nr = - a / 2. out->write( r ).", "4 \n4-\n"],
  ["the result field takes part in the calculation type", "DATA a TYPE i VALUE 7.\nDATA p TYPE p LENGTH 8 DECIMALS 2.\np = a / 2. out->write( p ).", "3.50 \n"],
  ["priorities, parentheses, ** from the right", "DATA r TYPE i.\nr = 2 + 3 * 4 ** 2 - ( 1 + 1 ) * 3 DIV 2. out->write( r ).\nr = 2 ** 3 ** 2. out->write( r ).", "47 \n512 \n"],
  ["a string result calculates in p", "DATA s TYPE string.\ns = 1 / 3. out->write( s ).", "0.33333333333333 \n"],
  ["assignment operators", "DATA r TYPE i VALUE 7.\nr += 3. r *= 2. r -= 1. r /= 4. out->write( r ).", "5 \n"],
  ["abs, ipow, sqrt", "DATA a TYPE i VALUE -3.\nDATA r TYPE i.\nDATA f TYPE f.\nr = ipow( base = 2 exp = 10 ) + abs( a ). out->write( r ).\nf = sqrt( 16 ). out->write( f ).", "1027 \n4.0000000000000000E+00\n"],
  ["a number literal beyond i is a p", "DATA r TYPE int8.\nr = 3000000000 + 1. out->write( r ).", "3000000001 \n"],
  ["a lone + makes an arithmetic expression", "DATA t TYPE c LENGTH 6 VALUE '1.25'.\nDATA n TYPE n LENGTH 4.\nn = t. out->write( n ).\nn = + t. out->write( n ).", "0125\n0001\n"],
  ["parentheses around a data object do not make an arithmetic expression", "DATA t TYPE c LENGTH 6 VALUE '1.25'.\nDATA n TYPE n LENGTH 4.\nn = ( t ). out->write( n ).\nn = ( ( t ) ). out->write( n ).\nn = + ( t ). out->write( n ).", "0125\n0125\n0001\n"],
  // as data objects, '01' differs from '1' as text and '1.4' is rounded to the i it is compared with
  ["parentheses around a data object in a comparison", `DATA a TYPE c LENGTH 5 VALUE '01'.
DATA b TYPE c LENGTH 5 VALUE '1'.
DATA t TYPE c LENGTH 5 VALUE '1.4'.
DATA i TYPE i VALUE 1.
IF ( a ) = b OR a = ( b ). out->write( 'equal' ). ELSE. out->write( 'differs' ). ENDIF.
IF ( t ) = i AND i = ( ( t ) ) AND ( t ) BETWEEN i AND i. out->write( 'equal' ). ELSE. out->write( 'differs' ). ENDIF.
IF + t = i. out->write( 'equal' ). ELSE. out->write( 'differs' ). ENDIF.`, "differs\nequal\ndiffers\n"],
  ["a sign applies to the power, a negative literal is one operand", "DATA r TYPE i.\nr = - 7 ** 2. out->write( r ).\nr = -7 ** 2. out->write( r ).\nr = 2 * - 7 ** 2. out->write( r ).", "49-\n49 \n98-\n"],
  ["MOD and DIV are Euclidean", "DATA a TYPE i VALUE -7.\nDATA r TYPE i.\nr = a MOD 3. out->write( r ).\nr = a DIV 3. out->write( r ).", "2 \n3-\n"],
];
for (const [name, body, stdout] of calculations) {
  test(`classrun arithmetic: ${name}`, () => {
    assert.deepEqual(run("clas", classrun(body)), { stdout });
  });
}

const calculationErrors: [string, string, RegExp][] = [
  ["an interim result beyond i", "DATA r TYPE i VALUE 2147483647.\nr = r + 1 - 1.", /CX_SY_ARITHMETIC_OVERFLOW/],
  ["division by zero", "DATA r TYPE i VALUE 1.\nDATA z TYPE i.\nr = r / z.", /CX_SY_ZERODIVIDE/],
];
for (const [name, body, failed] of calculationErrors) {
  test(`classrun arithmetic error: ${name}`, () => {
    const result = run("clas", classrun(body + "\nout->write( 'after' )."));
    assert.equal(result.stdout, "");
    assert.match(result.failed ?? "", failed);
  });
}

test("report: WRITE of a calculated i", () => {
  assert.deepEqual(run("prog", "REPORT zprobe.\nDATA x TYPE i VALUE 5.\nx = x * x - 1.\nWRITE x."), { stdout: "        24\n" });
});

// Classrun: one line per write, as open-steamgate's ZCL_OSD_CLASSRUN_OUT.
const classruns: [string, string, string][] = [
  ["hello world", "out->write( 'Hello, World!' ).", "Hello, World!\n"],
  ["data and name", "out->write( data = `v` name = 'n' ).", "n = v\n"],
  ["empty name is no name", "out->write( data = 'v' name = `` ).", "v\n"],
  ["c to string drops trailing blanks", "out->write( 'a  ' ). out->write( '' ). out->write( ` b ` ).", "a\n\n b \n"],
];
for (const [name, body, stdout] of classruns) {
  test(`classrun: ${name}`, () => {
    assert.deepEqual(run("clas", classrun(body)), { stdout });
  });
}

// Moves and out->write( variable ) follow the conversion rules (docs/spec/conversion.md); each expected output
// is a cell of runtime/go/abap/testdata/conversion.tsv.
const conversions: [string, string, string][] = [
  ["i to string has the sign at the end", "DATA i TYPE i VALUE -7. out->write( i ).", "7-\n"],
  ["a positive i to string ends in a blank", "DATA i TYPE i VALUE 42. out->write( i ).", "42 \n"],
  ["p to a short c", "DATA p TYPE p LENGTH 8 DECIMALS 2 VALUE '1.5'. DATA c TYPE c LENGTH 3. c = p. out->write( c ).", "*50\n"],
  ["int8 to d with its lower four bytes, to t with its whole value", "DATA i8 TYPE int8. DATA d TYPE d. DATA t TYPE t.\ni8 = 4294967296 + 738000. d = i8. t = i8. out->write( d ). out->write( t ).", "20210728\n192816\n"],
  ["text to i, sign at the end","DATA s TYPE string VALUE ` 12- `. DATA i TYPE i. i = s. out->write( i ).", "12-\n"],
  ["d to i counts days on the Julian calendar before 1582", "DATA d TYPE d VALUE '19000101'. DATA i TYPE i. i = d. out->write( i ).", "693597 \n"],
  ["i to d", "DATA i TYPE i VALUE 577737. DATA d TYPE d. d = i. out->write( d ).", "15821015\n"],
  ["f to string", "DATA f TYPE f VALUE '0.1'. out->write( f ).", "1.0000000000000001E-01\n"],
  ["decfloat34 keeps its scale", "DATA d TYPE decfloat34 VALUE '1.00'. out->write( d ).", "1.00\n"],
  ["x from i", "DATA i TYPE i VALUE -7. DATA x TYPE x LENGTH 4. x = i. out->write( x ).", "FFFFFFF9\n"],
  ["utclong from text", "DATA u TYPE utclong. DATA s TYPE string VALUE `2024-02-29T12:34:56,5`. u = s. out->write( u ).", "2024-02-29 12:34:56.5000000\n"],
  ["n keeps only the digits of text", "DATA n TYPE n LENGTH 4. n = 'a1b2c3'. out->write( n ).", "0123\n"],
  ["same type is a copy", "DATA a TYPE c LENGTH 3 VALUE 'ab'. DATA b TYPE c LENGTH 3. b = a. out->write( data = b name = 'b' ).", "b = ab\n"],
];
for (const [name, body, stdout] of conversions) {
  test(`classrun conversion: ${name}`, () => {
    assert.deepEqual(run("clas", classrun(body)), { stdout });
  });
}

test("an uncaught conversion exception ends the program", () => {
  const result = run("clas", classrun("out->write( 'before' ). DATA i TYPE i. DATA s TYPE string VALUE `2147483648`. i = s. out->write( 'after' )."));
  assert.equal(result.stdout, "before\n");
  assert.match(result.failed ?? "", /CX_SY_CONVERSION_OVERFLOW/);
});

test("report: DATA and moves run before WRITE", () => {
  assert.deepEqual(run("prog", "REPORT zprobe.\nDATA s TYPE string.\nDATA i TYPE i VALUE 5.\ns = i.\nWRITE 'done'."), { stdout: "done\n" });
});

const classrunRefusals: [string, string, RegExp][] = [
  ["chained write", "out->write( 'a' )->write( 'b' ).", /only out->write/],
  ["other statement", "DATA x TYPE i. CLEAR x.", /statement Clear is not compiled yet/],
  ["non-literal data", "out->write( sy-uname ).", /only a literal, a variable or a subfield/],
];
for (const [name, body, refused] of classrunRefusals) {
  test(`classrun refused: ${name}`, () => {
    const result = run("clas", classrun(body));
    assert.ok(result.refused !== undefined, `built, stdout ${JSON.stringify(result.stdout)}`);
    assert.match(result.refused, refused);
  });
}

test("classrun refused: constructor", () => {
  const source = `CLASS zcl_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    METHODS constructor.
ENDCLASS.
CLASS zcl_probe IMPLEMENTATION.
  METHOD constructor.
  ENDMETHOD.
  METHOD if_oo_adt_classrun~main.
  ENDMETHOD.
ENDCLASS.
`;
  assert.match(run("clas", source).refused ?? "", /CONSTRUCTOR is not compiled yet/);
});

test("class without IF_OO_ADT_CLASSRUN is not a root", () => {
  const source = `CLASS zcl_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
ENDCLASS.
CLASS zcl_probe IMPLEMENTATION.
ENDCLASS.
`;
  assert.match(run("clas", source).refused ?? "", /must implement IF_OO_ADT_CLASSRUN/);
});
