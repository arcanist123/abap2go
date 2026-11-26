import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classrun, run } from "./harness";

// IF, CASE, DO, WHILE, EXIT, CONTINUE, CHECK, RETURN and sy-index. Conditions follow docs/spec/comparison.md; the
// cells of comparison_expr.tsv run in comparison_expr.test.ts.

// out->write( ) of an i writes it converted to a string, with the blank of its sign after it
const lines = (...l: (string | number)[]) => l.map(x => typeof x === "number" ? `${x} \n` : `${x}\n`).join("");

test("IF: the first branch whose condition holds runs, else ELSE", () => {
  const source = classrun(`DATA a TYPE i VALUE 2.
DO 4 TIMES.
  a = sy-index.
  IF a = 1.
    out->write( 'one' ).
  ELSEIF a = 2.
    out->write( 'two' ).
  ELSEIF a >= 2.
    out->write( 'two or more' ).
  ELSE.
    out->write( 'never' ).
  ENDIF.
  IF a > 3.
    out->write( 'more than three' ).
  ENDIF.
ENDDO.`);
  assert.deepEqual(run("clas", source), { stdout: lines("one", "two", "two or more", "two or more", "more than three") });
});

test("IF: nested, with empty branches", () => {
  const source = classrun(`DATA a TYPE i VALUE 1.
DATA b TYPE c LENGTH 1 VALUE 'x'.
IF a = 1.
  IF b = 'y'.
  ELSE.
    out->write( 'inner else' ).
  ENDIF.
ELSE.
ENDIF.
IF a = 2.
ENDIF.`);
  assert.deepEqual(run("clas", source), { stdout: lines("inner else") });
});

test("CASE: the first WHEN with an equal value, by the comparison rules; WHEN OTHERS otherwise", () => {
  const source = classrun(`DATA a TYPE i.
DATA t TYPE c LENGTH 3 VALUE '3'.
DO 5 TIMES.
  a = sy-index.
  CASE a.
    WHEN 1 OR '2'.
      out->write( 'one or two' ).
    WHEN t.
      out->write( 'three' ).
    WHEN 3 OR 4.
      out->write( 'four' ).
    WHEN OTHERS.
      out->write( 'other' ).
  ENDCASE.
ENDDO.
CASE t.
  WHEN '3  '.
    out->write( 'blanks do not count' ).
ENDCASE.
CASE a.
  WHEN OTHERS.
    out->write( 'only others' ).
ENDCASE.`);
  assert.deepEqual(run("clas", source), { stdout: lines("one or two", "one or two", "three", "four", "other", "blanks do not count", "only others") });
});

test("CASE: a value that is no number in a numeric comparison is the runtime error CONVT_NO_NUMBER", () => {
  const result = run("clas", classrun(`DATA a TYPE i VALUE 1.
DATA t TYPE c LENGTH 3 VALUE 'abc'.
CASE a.
  WHEN 1.
    out->write( 'one' ).
  WHEN t.
ENDCASE.
CASE a.
  WHEN t.
    out->write( 'not reached' ).
ENDCASE.`));
  assert.equal(result.stdout, lines("one"));
  assert.match(result.failed ?? "", /CONVT_NO_NUMBER/);
});

test("DO: n TIMES, sy-index, nested loops, sy-index back to its value before the loop", () => {
  const source = classrun(`out->write( sy-index ).
DO 3 TIMES.
  DO 2 TIMES.
  ENDDO.
  out->write( sy-index ).
ENDDO.
out->write( sy-index ).
DO 0 TIMES.
  out->write( 'never' ).
ENDDO.`);
  assert.deepEqual(run("clas", source), { stdout: lines(0, 1, 2, 3, 0) });
});

test("DO: n is converted to i once, before the first pass", () => {
  const source = classrun(`DATA n TYPE i VALUE 3.
DATA k TYPE i.
DATA c TYPE c LENGTH 5 VALUE '2.5'.
DATA p TYPE p LENGTH 8 DECIMALS 1 VALUE '-1.5'.
DO n TIMES.
  n = 10.
  k = k + 1.
ENDDO.
out->write( k ).
k = 0.
DO c TIMES.
  k = k + 1.
ENDDO.
out->write( k ).
k = 0.
DO p TIMES.
  k = k + 1.
ENDDO.
out->write( k ).
DO c(1) TIMES.
  out->write( sy-index ).
ENDDO.`);
  assert.deepEqual(run("clas", source), { stdout: lines(3, 3, 0, 1, 2) });
});

test("DO: EXIT leaves the innermost loop, CONTINUE and CHECK go on with its next pass", () => {
  const source = classrun(`DO.
  IF sy-index = 4.
    EXIT.
  ENDIF.
  DO.
    EXIT.
  ENDDO.
ENDDO.
out->write( sy-index ).
DO 3 TIMES.
  IF sy-index = 2.
    CONTINUE.
  ENDIF.
  out->write( sy-index ).
ENDDO.
DO 3 TIMES.
  CHECK sy-index <> 2.
  out->write( sy-index ).
ENDDO.
DO 3 TIMES.
  CASE sy-index.
    WHEN 2.
      EXIT.
  ENDCASE.
  out->write( sy-index ).
ENDDO.`);
  assert.deepEqual(run("clas", source), { stdout: lines(0, 1, 3, 1, 3, 1) });
});

test("WHILE: sy-index is the number of the pass when the condition is evaluated", () => {
  const source = classrun(`DATA k TYPE i.
DO 2 TIMES.
  WHILE sy-index < 4.
    k = k + 1.
    out->write( sy-index ).
  ENDWHILE.
  out->write( sy-index ).
ENDDO.
out->write( k ).
k = 0.
WHILE k < 3.
  k = k + 1.
  CHECK k <> 2.
  out->write( k ).
ENDWHILE.
WHILE 1 = 1.
  IF sy-index = 3.
    EXIT.
  ENDIF.
ENDWHILE.
out->write( sy-index ).`);
  assert.deepEqual(run("clas", source), { stdout: lines(1, 2, 3, 1, 1, 2, 3, 2, 6, 1, 3, 0) });
});

test("DATA is not executable: a variable declared in a loop keeps its value, and is known after the block", () => {
  const source = classrun(`DO 3 TIMES.
  DATA k TYPE i VALUE 5.
  k = k + 1.
ENDDO.
out->write( k ).
IF k = 0.
  DATA s TYPE string VALUE \`start\`.
ENDIF.
out->write( s ).`);
  assert.deepEqual(run("clas", source), { stdout: lines(8, "start") });
});

test("conditions: AND and OR stop once the value is known, EQUIV evaluates both sides", () => {
  const source = classrun(`DATA x TYPE i VALUE 1.
DATA z TYPE i.
DATA s TYPE string VALUE \`ab\`.
DATA off TYPE i VALUE 5.
IF x = 1 OR 1 / z = 1.
  out->write( 'or' ).
ENDIF.
IF x = 0 AND 1 / z = 1.
ELSE.
  out->write( 'and' ).
ENDIF.
IF x = 1 OR s+off(1) = 'a'.
  out->write( 'subfield not taken' ).
ENDIF.
IF x = 1.
  out->write( 'if' ).
ELSEIF s+off(1) = 'a'.
ENDIF.
IF x = 1 EQUIV 1 / z = 1.
ENDIF.`);
  const result = run("clas", source);
  assert.equal(result.stdout, lines("or", "and", "subfield not taken", "if"));
  assert.match(result.failed ?? "", /CX_SY_ZERODIVIDE/);
});

test("conditions: NOT can be repeated, an even number of NOT cancels out, NOT binds more strongly than OR", () => {
  const source = classrun(`DATA x TYPE i VALUE 1.
IF NOT NOT x = 1.
  out->write( 'not not' ).
ENDIF.
IF NOT NOT NOT x = 1.
  out->write( 'never' ).
ENDIF.
IF NOT NOT x = 2 OR x = 1.
  out->write( 'not not, or' ).
ENDIF.
IF NOT NOT ( x = 1 AND x <> 2 ).
  out->write( 'not not, parentheses' ).
ENDIF.
IF NOT NOT NOT ( x = 2 ).
  out->write( 'not not not, parentheses' ).
ENDIF.`);
  assert.deepEqual(run("clas", source), { stdout: lines("not not", "not not, or", "not not, parentheses", "not not not, parentheses") });
});

test("conditions: an exception in an arithmetic operand of a WHILE condition ends the program", () => {
  const result = run("clas", classrun(`DATA z TYPE i VALUE 2.
WHILE 4 / z > 1.
  out->write( z ).
  z = z - 1.
ENDWHILE.`));
  assert.equal(result.stdout, lines(2, 1));
  assert.match(result.failed ?? "", /CX_SY_ZERODIVIDE/);
});

test("control flow in a report", () => {
  const source = `REPORT zprobe.
DATA a TYPE i.
START-OF-SELECTION.
  DO 3 TIMES.
    a = sy-index * 10.
    IF a BETWEEN 15 AND 25.
      WRITE / a.
    ELSE.
      WRITE / 'no'.
    ENDIF.
  ENDDO.`;
  // an i takes 11 columns, the last one for its sign
  assert.deepEqual(run("prog", source), { stdout: lines("no", "        20", "no") });
});

// Outside a loop, RETURN, EXIT and a CHECK whose condition does not hold leave the processing block
for (const leave of ["RETURN.", "EXIT.", "CHECK 1 = 0."]) {
  test(`${leave} outside a loop leaves the method, also from within IF and CASE`, () => {
    const source = classrun(`DATA a TYPE i VALUE 1.
out->write( 'before' ).
IF a = 1.
  CASE a.
    WHEN 1.
      ${leave}
  ENDCASE.
  out->write( 'not reached in IF' ).
ENDIF.
out->write( 'not reached' ).`);
    assert.deepEqual(run("clas", source), { stdout: lines("before") });
  });

  test(`${leave} outside a loop leaves START-OF-SELECTION, and the list is written`, () => {
    // the last line is not finished when the block is left
    const source = `REPORT zprobe.
START-OF-SELECTION.
  WRITE 'first'.
  WRITE / 'last'.
  WRITE 'line'.
  ${leave}
  WRITE / 'not reached'.`;
    assert.deepEqual(run("prog", source), { stdout: lines("first", "last line") });
  });
}

test("RETURN in nested loops leaves the whole processing block", () => {
  const body = `DATA k TYPE i.
DO 3 TIMES.
  WHILE k < 10.
    k = k + 1.
    DO 3 TIMES.
      IF k = 2.
        RETURN.
      ENDIF.
    ENDDO.
  ENDWHILE.
  k = 100.
ENDDO.`;
  assert.deepEqual(run("clas", classrun(`out->write( 'before' ).
${body}
out->write( 'not reached' ).`)),
    { stdout: lines("before") });
  assert.deepEqual(run("prog", `REPORT zprobe.
WRITE 'before'.
${body}
WRITE / 'not reached'.`), { stdout: lines("before") });
});

test("CHECK outside a loop does nothing when the condition holds", () => {
  const classBody = `DATA a TYPE i VALUE 1.
CHECK a = 1.
IF a = 1.
  CHECK a <> 2.
  out->write( 'in IF' ).
ENDIF.
out->write( 'after' ).`;
  assert.deepEqual(run("clas", classrun(classBody)), { stdout: lines("in IF", "after") });
  const report = `REPORT zprobe.
DATA a TYPE i VALUE 1.
CHECK a = 1.
WRITE 'after'.`;
  assert.deepEqual(run("prog", report), { stdout: lines("after") });
});

test("CHECK outside a loop evaluates its condition with short circuit", () => {
  const declarations = `DATA x TYPE i VALUE 1.
DATA z TYPE i.
DATA s TYPE string VALUE \`ab\`.
DATA off TYPE i VALUE 5.`;
  const passed = run("clas", classrun(`${declarations}
CHECK x = 1 OR 1 / z = 1.
CHECK x = 1 OR s+off(1) = 'a'.
out->write( 'passed' ).
CHECK x = 0 AND 1 / z = 1.
out->write( 'not reached' ).`));
  assert.deepEqual(passed, { stdout: lines("passed") });
  const report = `REPORT zprobe.
${declarations}
CHECK x = 1 OR 1 / z = 1.
WRITE 'passed'.
CHECK x = 0 AND s+off(1) = 'a'.
WRITE / 'not reached'.`;
  assert.deepEqual(run("prog", report), { stdout: lines("passed") });
  const raised = run("clas", classrun(`${declarations}
out->write( 'before' ).
CHECK 1 / z = 1 OR x = 1.
out->write( 'not reached' ).`));
  assert.equal(raised.stdout, lines("before"));
  assert.match(raised.failed ?? "", /CX_SY_ZERODIVIDE/);
});

// A report can have several START-OF-SELECTION blocks, the statements before the first one being a block of their
// own. They run in order, and each starts a new line of the list.
test("START-OF-SELECTION: each block starts a new line", () => {
  const source = `REPORT zprobe.
WRITE 'implicit'.
START-OF-SELECTION.
  WRITE 'second'.
  WRITE 'same line'.
START-OF-SELECTION.
START-OF-SELECTION.
  WRITE / 'fourth'.`;
  assert.deepEqual(run("prog", source), { stdout: lines("implicit", "second same line", "fourth") });
});

test("START-OF-SELECTION: CHECK outside a loop leaves its block only, the next block runs", () => {
  const source = `REPORT zprobe.
DATA k TYPE i.
WRITE 'implicit'.
CHECK k = 1.
WRITE 'not reached'.
START-OF-SELECTION.
  WRITE 'second'.
  IF k = 0.
    CHECK k = 1.
  ENDIF.
  WRITE 'not reached'.
START-OF-SELECTION.
  DO 2 TIMES.
    CHECK sy-index = 2.
    WRITE 'pass two'.
  ENDDO.
  CHECK k = 0.
  WRITE 'third'.
START-OF-SELECTION.
  WRITE 'fourth'.
  CHECK k = 1.
  WRITE 'not reached'.`;
  assert.deepEqual(run("prog", source), { stdout: lines("implicit", "second", "pass two third", "fourth") });
});

for (const leave of ["RETURN.", "EXIT."]) {
  test(`START-OF-SELECTION: ${leave} outside a loop skips the blocks after its own`, () => {
    const source = (first: string) => `REPORT zprobe.
DATA k TYPE i.
WRITE 'implicit'.
${first}
START-OF-SELECTION.
  WRITE 'second'.
  DO 1 TIMES.
    EXIT.
  ENDDO.
  IF k = 0.
    ${leave}
  ENDIF.
  WRITE 'not reached'.
START-OF-SELECTION.
  WRITE 'not reached'.`;
    assert.deepEqual(run("prog", source("")), { stdout: lines("implicit", "second") });
    assert.deepEqual(run("prog", source(leave)), { stdout: lines("implicit") });
  });
}

const refusals: [string, string, RegExp][] = [
  ["CONTINUE outside a loop", "IF 1 = 1. CONTINUE. ENDIF.", /CONTINUE is only possible in a loop/],
  ["RETURN with an operand outside a functional method", "RETURN 1.", /does not have a RETURNING parameter/],
  ["EXIT FROM STEP-LOOP", "EXIT FROM STEP-LOOP.", /no additions are supported/],
  ["EXIT FROM SQL", "EXIT FROM SQL.", /no additions are supported/],
  ["CHECK without a condition", "CHECK sy-index.", /only CHECK <condition>/],
  ["DO VARYING", "DATA a TYPE i.\nDATA b TYPE i.\nDATA c TYPE i.\nDO 2 TIMES VARYING a FROM b NEXT c.\nENDDO.", /not VARYING/],
  ["WHILE VARY", "DATA a TYPE i.\nDATA b TYPE i.\nDATA c TYPE i.\nWHILE 1 = 0 VARY a FROM b NEXT c.\nENDWHILE.", /VARY is not supported/],
  ["DO with an arithmetic expression", "DATA a TYPE i.\nDO a + 1 TIMES.\nENDDO.", /only a literal, a variable or a subfield/],
  ["CASE without WHEN", "DATA a TYPE i.\nCASE a.\nENDCASE.", /CASE without WHEN/],
  ["d compared with t", "DATA d TYPE d.\nDATA t TYPE t.\nIF d = t.\nENDIF.", /no comparison type/],
  ["utclong compared with i", "DATA u TYPE utclong.\nIF u = 1.\nENDIF.", /no comparison type/],
  ["a text operand against an arithmetic expression", "DATA a TYPE i.\nDATA c TYPE c LENGTH 3.\nIF a + 0 = c.\nENDIF.", /cannot be compared with/],
  ["IS INITIAL", "DATA a TYPE i.\nIF a IS INITIAL.\nENDIF.", /not IS, IN or other predicates/],
  ["a write to sy-index", "DO 2 TIMES.\nsy-index = 1.\nENDDO.", /only a variable or a subfield is supported as target/],
];
for (const [name, body, refused] of refusals) {
  test(`refused: ${name}`, () => {
    const result = run("clas", classrun(body));
    assert.ok(result.refused !== undefined, `built, stdout ${JSON.stringify(result.stdout)}`);
    assert.match(result.refused, refused);
  });
}

test("refused: WRITE of sy-index, which has the output length of its data element", () => {
  const result = run("prog", "DO 1 TIMES.\nWRITE sy-index.\nENDDO.");
  assert.match(result.refused ?? "", /WRITE of sy-index/);
});
