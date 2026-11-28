import { test } from "node:test";
import * as assert from "node:assert/strict";
import { syntaxCheck } from "../harness";

// In a Unicode program the statements on character strings are expected to take character-like operands only, and in
// byte mode byte-like ones.

const DECL = `REPORT zprobe.
DATA c TYPE c LENGTH 10.
DATA c1 TYPE c LENGTH 1.
DATA n TYPE n LENGTH 8.
DATA d TYPE d.
DATA s TYPE string.
DATA x TYPE x LENGTH 4.
DATA x1 TYPE x LENGTH 1.
DATA xs TYPE xstring.
DATA i TYPE i.
DATA p TYPE p LENGTH 8.
CONSTANTS two TYPE c LENGTH 2 VALUE 'ab'.
DATA: BEGIN OF flat, a TYPE c LENGTH 4, BEGIN OF inner, b TYPE n LENGTH 4, END OF inner, e TYPE d, END OF flat.
DATA: BEGIN OF one, a TYPE c LENGTH 1, END OF one.
DATA: BEGIN OF mixed, a TYPE c LENGTH 4, b TYPE i, END OF mixed.
DATA: BEGIN OF bytes, a TYPE x LENGTH 2, END OF bytes.
DATA: BEGIN OF deep, a TYPE c LENGTH 4, b TYPE string, END OF deep.
DATA header LIKE STANDARD TABLE OF mixed WITH HEADER LINE.
DATA chars LIKE STANDARD TABLE OF flat WITH HEADER LINE.
DATA tab TYPE STANDARD TABLE OF string WITH EMPTY KEY.`;
const FIRST = DECL.split("\n").length + 1;

function findings(statements: readonly string[]): string[] {
  return syntaxCheck("prog", [DECL, ...statements].join("\n"));
}

const CHARACTER = "character-like (type c, n, d, t or string)";
const FLAT = "character-like (type c, n, d or t)";
const BYTE = "byte-like (type x or xstring)";

/** A statement and the operand of it that is expected to be rejected. */
const wrong: [string, string, string][] = [
  ["CONDENSE x.", "x", CHARACTER],
  ["CONDENSE mixed.", "mixed", CHARACTER],
  ["CONDENSE deep.", "deep", CHARACTER],
  ["CONDENSE header.", "header", CHARACTER],
  ["CONDENSE i+0.", "i+0", CHARACTER],
  ["TRANSLATE i TO UPPER CASE.", "i", CHARACTER],
  ["TRANSLATE c USING xs.", "xs", CHARACTER],
  ["SPLIT x AT ',' INTO c s.", "x", CHARACTER],
  ["SPLIT c AT 1 INTO c s.", "1", CHARACTER],
  ["OVERLAY x WITH c.", "x", CHARACTER],
  ["OVERLAY c WITH s ONLY p.", "p", CHARACTER],
  ["SHIFT p.", "p", CHARACTER],
  ["SHIFT c UP TO i.", "i", CHARACTER],
  ["SHIFT c LEFT DELETING LEADING x.", "x", CHARACTER],
  ["SEARCH x FOR 'a'.", "x", CHARACTER],
  ["SEARCH c FOR i.", "i", CHARACTER],
  ["SEARCH header FOR 'a'.", "header", CHARACTER],
  ["FIND 'a' IN x.", "x", CHARACTER],
  ["FIND i IN c.", "i", CHARACTER],
  ["FIND 'a' IN SECTION OFFSET 1 OF mixed.", "mixed", CHARACTER],
  ["CLEAR x WITH 'a'.", "x", CHARACTER],
  ["CLEAR c WITH i.", "i", CHARACTER],
  ["CONCATENATE x x INTO bytes IN BYTE MODE.", "bytes", BYTE],
  ["FIND x IN c IN BYTE MODE.", "c", BYTE],
  ["FIND 'a' IN x IN BYTE MODE.", "'a'", BYTE],
  ["REPLACE x IN bytes WITH x IN BYTE MODE.", "bytes", BYTE],
  ["CLEAR x WITH 'a' IN BYTE MODE.", "'a'", BYTE],
  ["SET BIT 1 OF bytes.", "bytes", BYTE],
  ["GET BIT 1 OF bytes INTO i.", "bytes", BYTE],
  ["UNPACK p TO x.", "x", FLAT],
  ["UNPACK p TO s.", "s", FLAT],
  ["DESCRIBE FIELD s LENGTH i IN CHARACTER MODE.", "s", FLAT],
  ["DESCRIBE FIELD x LENGTH i IN CHARACTER MODE.", "x", FLAT],
  ["DESCRIBE FIELD mixed LENGTH i IN CHARACTER MODE.", "mixed", FLAT],
];

test("operands of the wrong kind", () => {
  const found = findings(wrong.map(([statement]) => statement));
  assert.deepEqual(found.map(f => f.replace(/:\d+:/, ":")).sort(),
    wrong.map(([, operand, kind], i) => `${FIRST + i}: "${operand}" must be ${kind} [operand_kind]`).sort());
});

// forms of the same rules that abaplint reports; its findings stop layer 2 for the object
test("operands of the wrong kind that abaplint reports", () => {
  assert.deepEqual(findings(["SHIFT c LEFT BY 1 PLACES IN BYTE MODE.", "SPLIT x AT c INTO xs xs IN BYTE MODE."])
    .map(f => f.replace(/:\d+:/, ":")), [
    `${FIRST}: Shift, Target not hex like [check_syntax]`,
    `${FIRST + 1}: Incompatible, source not byte like [check_syntax]`,
  ]);
});

const long: [string, string][] = [
  ["CLEAR c WITH 'ab'.", "'ab'"],
  ["CLEAR c WITH 'a '.", "'a '"],
  ["CLEAR c WITH two.", "two"],
  ["CLEAR c WITH c.", "c"],
  ["CLEAR c WITH c+1.", "c+1"],
  ["CLEAR c WITH c(2).", "c(2)"],
  ["CLEAR c WITH d.", "d"],
  ["CLEAR c WITH flat.", "flat"],
  ["CLEAR x WITH x IN BYTE MODE.", "x"],
  ["CLEAR x WITH x(2) IN BYTE MODE.", "x(2)"],
];

test("a value of CLEAR ... WITH longer than 1", () => {
  const found = findings(long.map(([statement]) => statement));
  assert.deepEqual(found.map(f => f.replace(/:\d+:/, ":")).sort(),
    long.map(([, operand], i) => `${FIRST + i}: "${operand}" must have the length 1 [clear_value_length]`).sort());
});

test("character-like and byte-like operands", () => {
  assert.deepEqual(findings([
    "CONDENSE c.", "CONDENSE flat.", "CONDENSE chars.", "CONDENSE n.", "CONDENSE c+1(2).",
    "TRANSLATE s TO UPPER CASE.", "TRANSLATE c USING 'ab'.",
    "SPLIT |a,b| AT ',' INTO c s.", "SPLIT c && s AT space INTO TABLE tab.",
    "SPLIT x AT x1 INTO xs xs IN BYTE MODE.",
    "OVERLAY c WITH s ONLY 'ab'.",
    "SHIFT flat.", "SHIFT c BY i PLACES.", "SHIFT c UP TO to_upper( s ).", "SHIFT x LEFT BY 1 PLACES IN BYTE MODE.",
    "SEARCH c FOR 'a'.", "SEARCH tab FOR 'a'.", "SEARCH chars FOR 'a'.",
    "FIND 'a' IN d.", "FIND ALL OCCURRENCES OF 'a' IN c MATCH COUNT i.", "FIND x1 IN xs IN BYTE MODE.",
    "FIND 'a' IN TABLE tab.", "FIND REGEX 'a' IN s.",
    "CONCATENATE LINES OF tab INTO s SEPARATED BY ','.",
    "REPLACE x1 IN x WITH x1 IN BYTE MODE.",
    "CLEAR c WITH ''.", "CLEAR c WITH ''''.", "CLEAR c WITH `ab`.", "CLEAR c WITH s.", "CLEAR c WITH c1.",
    "CLEAR c WITH one.", "CLEAR c WITH c+9.", "CLEAR c WITH c(i).", "CLEAR c WITH n(1).", "CLEAR c WITH space.",
    "CLEAR x WITH x1 IN BYTE MODE.", "CLEAR x WITH x+3 IN BYTE MODE.", "CLEAR x WITH xs IN BYTE MODE.",
    "SET BIT 1 OF x.", "GET BIT 1 OF xs INTO i.",
    "UNPACK p TO c.", "UNPACK p TO flat.",
    "DESCRIBE FIELD c LENGTH i IN CHARACTER MODE.", "DESCRIBE FIELD flat LENGTH i IN CHARACTER MODE.",
    "DESCRIBE FIELD x LENGTH i IN BYTE MODE.",
  ]), []);
});

// a generic operand is rejected only where none of the types it stands for would do
const generic: [string, string, string | undefined][] = [
  ["any", "CONDENSE v.", undefined],
  ["any", "SET BIT 1 OF v.", undefined],
  ["clike", "CONDENSE v.", undefined],
  ["csequence", "DESCRIBE FIELD v LENGTH sy-tabix IN CHARACTER MODE.", undefined],
  ["c", "SHIFT v.", undefined],
  ["xsequence", "SET BIT 1 OF v.", undefined],
  ["xsequence", "CONDENSE v.", CHARACTER],
  ["numeric", "CONDENSE v.", CHARACTER],
  ["p", "CONDENSE v.", CHARACTER],
];
for (const [type, statement, kind] of generic) {
  test(`a generic operand of type ${type}: ${statement}`, () => {
    const source = `REPORT zprobe.\nFORM f USING v TYPE ${type}.\n${statement}\nENDFORM.`;
    assert.deepEqual(syntaxCheck("prog", source).map(f => f.replace(/:\d+:/, ":")),
      kind === undefined ? [] : [`3: "v" must be ${kind} [operand_kind]`]);
  });
}
