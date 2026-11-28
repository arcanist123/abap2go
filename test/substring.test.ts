import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classrun, run } from "./harness";

// strlen( ) and offset/length access. Both count characters as UTF-16 code units (bytes for x and xstring), so a
// character outside the Basic Multilingual Plane counts two. As far as we know from the ABAP keyword documentation
// and experience: strlen( ) ignores the trailing blanks of a flat field but not of a string; the subfield of c is a
// c, of n, d and t an n, of x an x, of string and xstring the same type; a subfield of a flat field must lie within
// it and be at least one character long, a subfield of a string lies within its current length and may be empty.

const DECLARATIONS = `DATA c5 TYPE c LENGTH 5 VALUE 'ab'.
DATA s TYPE string VALUE \`abc  d\`.
DATA n4 TYPE n LENGTH 4 VALUE '12'.
DATA d TYPE d VALUE '20240229'.
DATA t TYPE t VALUE '123456'.
DATA x4 TYPE x LENGTH 4 VALUE '01020304'.
DATA xs TYPE xstring VALUE '0A0B0C'.
DATA emoji TYPE string VALUE \`\u{1F600}a\`.
DATA rc TYPE c LENGTH 10 VALUE 'abcdefghij'.
DATA r TYPE string.
DATA i TYPE i.
DATA off TYPE i.
DATA len TYPE i.
DATA u TYPE utclong.
`;

const cases: [string, string, string][] = [
  ["strlen( ) of c ignores trailing blanks, of string not",
    "i = strlen( c5 ). out->write( i ).\nr = `ab  `. i = strlen( r ). out->write( i ).\nc5 = ' a'. i = strlen( c5 ). out->write( i ).",
    "2 \n4 \n2 \n"],
  ["strlen( ) of n, d and t", "i = strlen( n4 ). out->write( i ).\ni = strlen( d ). out->write( i ).\ni = strlen( t ). out->write( i ).",
    "4 \n8 \n6 \n"],
  ["strlen( ) of literals", "i = strlen( '' ). out->write( i ).\ni = strlen( `` ). out->write( i ).\ni = strlen( 'ab  ' ). out->write( i ).\ni = strlen( ` ab ` ) + 1. out->write( i ).",
    "0 \n0 \n2 \n5 \n"],
  ["strlen( ) counts a character outside the Basic Multilingual Plane twice", "i = strlen( emoji ). out->write( i ).", "3 \n"],
  ["a subfield of a string is a string and keeps its blanks", "r = s+2(3). out->write( r ). i = strlen( r ). out->write( i ).", "c  \n3 \n"],
  ["a subfield of c is a c", "r = c5+1(3). out->write( r ). i = strlen( c5+1(3) ). out->write( i ).", "b\n1 \n"],
  ["the rest and the start", "r = s+2. out->write( r ).\nr = s(2). out->write( r ).\nr = c5+1. out->write( r ).", "c  d\nab\nb\n"],
  ["subfields of d, n, x and xstring", "i = d+4(2). out->write( i ).\ni = n4+2(2) + 1. out->write( i ).\nr = x4+1(2). out->write( r ).\nr = xs+1(1). out->write( r ).",
    "2 \n13 \n0203\n0B\n"],
  ["strlen( ) of a subfield of a string", "i = strlen( s+1(4) ). out->write( i ).", "4 \n"],
  ["writing a subfield cuts what does not fit", "r = `XYZW`. rc+2(3) = r. out->write( rc ).\nr = `QRS`. rc+8 = r. out->write( rc ).", "abXYZfghij\nabXYZfghQR\n"],
  ["writing a subfield converts to its type", "rc(2) = 7. out->write( rc ).\nx4+1(2) = 'FFEE'. out->write( x4 ).\nd+4(2) = '12'. out->write( d ).",
    "7 cdefghij\n01FFEE04\n20241229\n"],
  ["a calculation into a subfield", "rc+1(3) = 6 * 7. out->write( rc ).\nrc+1(3) += 1. out->write( rc ).", "a42 efghij\na43 efghij\n"],
  ["dynamic offsets and lengths", "off = 2. len = 3. r = s+off(len). out->write( r ).\nlen = 2. r = s(len). out->write( r ).\noff = 3. len = 2. rc+off(len) = '__'. out->write( rc ).\noff = 4. r = c5+off. out->write( r ).",
    "c  \nab\nabc__fghij\n\n"],
  ["an empty subfield at the end of a string", "off = 6. len = 0. r = s+off(len). i = strlen( r ). out->write( i ).\nr = s+off. i = strlen( r ). out->write( i ).", "0 \n0 \n"],
  ["subfields between the two code units of a character", "r = emoji+1(1). i = strlen( r ). out->write( i ).\nr = emoji+2(1). out->write( r ).", "1 \na\n"],
];
for (const [name, body, stdout] of cases) {
  test(`substring: ${name}`, () => {
    assert.deepEqual(run("clas", classrun(DECLARATIONS + body)), { stdout });
  });
}

const outOfBounds: [string, string][] = [
  ["a length of 0 in a flat field", "off = 4. len = 0. r = c5+off(len)."],
  ["the rest of a flat field from its end", "off = 5. r = c5+off."],
  ["beyond the end of a flat field", "off = 2. len = 4. r = c5+off(len)."],
  ["a negative offset", "off = -1. len = 1. r = s+off(len)."],
  ["a negative length", "len = -1. r = s(len)."],
  ["beyond the end of a string", "off = 7. r = s+off."],
  ["a target beyond the end", "off = 4. len = 2. c5+off(len) = 'zz'."],
  ["a static offset at the end of a flat field, with a variable length of 0", "len = 0. r = c5+5(len)."],
  ["a static offset at the end of a flat field, with a variable length", "len = 1. r = c5+5(len)."],
  ["a static offset beyond a flat field, with a variable length", "len = 1. r = c5+6(len)."],
  ["a static offset at the end of an x, with a variable length", "len = 1. r = x4+4(len)."],
  ["a target at a static offset at the end, with a variable length", "len = 1. c5+5(len) = 'z'."],
  ["a static length beyond a flat field, with a variable offset", "off = 0. r = c5+off(6)."],
];
for (const [name, body] of outOfBounds) {
  test(`substring out of bounds: ${name}`, () => {
    const result = run("clas", classrun(DECLARATIONS + "out->write( 'before' ).\n" + body + "\nout->write( 'after' )."));
    assert.equal(result.stdout, "before\n");
    assert.match(result.failed ?? "", /CX_SY_RANGE_OUT_OF_BOUNDS/);
  });
}

test("substring: WRITE of subfields has their length", () => {
  const source = "REPORT zprobe.\n" + DECLARATIONS + "WRITE s+1(3). WRITE 'x'.\nWRITE / c5+1(3). WRITE 'x'.\nWRITE / d+4(4). WRITE d(4).";
  assert.deepEqual(run("prog", source), { stdout: "bc  x\nb   x\n0229 2024\n" });
});

// What ABAP rejects as a syntax error is refused at build time by abaplint. Static bounds outside an n, d or t field
// are reported by layer 2, see test/check/substring.test.ts.
const refusals: [string, string, RegExp][] = [
  ["a static offset at the end of a flat field", "r = c5+5.", /syntax check/],
  ["a static offset beyond a flat field", "r = c5+6.", /syntax check/],
  ["a static offset at the end with a static length", "r = c5+5(1).", /syntax check/],
  ["static bounds beyond a flat field", "r = c5+4(2).", /syntax check/],
  ["static bounds beyond an x", "r = x4+3(2).", /syntax check/],
  ["a static length of 0", "r = c5+1(0).", /Substring length must be greater than 0 \[check_syntax\]/],
  ["a subfield of an i", "r = i+1(2).", /syntax check/],
  ["a subfield of a utclong", "r = u+1(1).", /"utclong" does not permit substrings to be accessed \[check_syntax\]/],
  ["writing a subfield of a utclong", "u(1) = r.", /"utclong" does not permit substrings to be accessed \[check_syntax\]/],
  ["writing a subfield of a string", "s+1(1) = r.", /syntax check/],
  ["strlen( ) of an i", "i = strlen( i ).", /syntax check/],
  ["strlen( ) of an x", "i = strlen( x4 ).", /syntax check/],
];
for (const [name, body, refused] of refusals) {
  test(`substring refused: ${name}`, () => {
    const result = run("clas", classrun(DECLARATIONS + body));
    assert.ok(result.refused !== undefined, `built, stdout ${JSON.stringify(result.stdout)}`);
    assert.match(result.refused, refused);
  });
}

// Offset/length access that takes a whole numeric field is valid ABAP, as is u(*) for a utclong; none of it is
// compiled yet.
const NUMERIC = `DATA i8 TYPE int8.
DATA p TYPE p LENGTH 5.
DATA f TYPE f.
DATA df16 TYPE decfloat16.
DATA df34 TYPE decfloat34.
`;
const numeric: [string, string, string, string][] = [
  ["an offset of 0 in an i", "r = i+0.", "i+0", "i"],
  ["the length * of an i", "r = i(*).", "i(*)", "i"],
  ["the length of an i", "r = i(4).", "i(4)", "i"],
  ["an offset and length of an i as target", "i+0(4) = '1'.", "i+0(4)", "i"],
  ["an int8", "r = i8+0.", "i8+0", "int8"],
  ["a p", "r = p(5).", "p(5)", "p"],
  ["an f", "r = f(8).", "f(8)", "f"],
  ["a decfloat16", "r = df16+0.", "df16+0", "decfloat16"],
  ["a decfloat34", "r = df34+0.", "df34+0", "decfloat34"],
  ["in WRITE", "WRITE i+0.", "i+0", "i"],
  ["in a calculation", "i = i+0 + 1.", "i+0", "i"],
  ["in a comparison", "IF i+0 = 1.\nENDIF.", "i+0", "i"],
  ["the length * of a utclong", "r = u(*).", "u(*)", "utclong"],
];
for (const [name, body, text, type] of numeric) {
  test(`substring not compiled yet: ${name}`, () => {
    const result = run("prog", "REPORT zprobe.\n" + DECLARATIONS + NUMERIC + body);
    const refused = result.refused ?? "";
    assert.ok(refused.includes(`${text}: offset/length access to a field of type ${type} is not compiled yet`),
      refused || `built, stdout ${JSON.stringify(result.stdout)}`);
    assert.doesNotMatch(refused, /syntax check/);
  });
}
