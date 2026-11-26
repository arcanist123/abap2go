import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { classrun, run } from "./harness";

test("every exception class the runtime raises is a class of the built-in library", () => {
  const root = path.join(__dirname, "..", "..");
  const dir = path.join(root, "runtime", "go", "abap");
  const raised = fs.readdirSync(dir).filter(f => f.endsWith(".go") && !f.endsWith("_test.go"))
    .flatMap(f => [...fs.readFileSync(path.join(dir, f), "utf-8").matchAll(/"(CX_[A-Z_]+)"/g)].map(m => m[1]));
  assert.ok(raised.length >= 9, `found ${raised.length}`);
  for (const cls of raised) {
    assert.ok(fs.existsSync(path.join(root, "lib", "src", `${cls.toLowerCase()}.clas.abap`)), `${cls} is not in lib/`);
  }
});

// TRY, CATCH, CLEANUP and RETRY (runtime/go/abap/try.go), and the value an exception leaves in its target
// (docs/spec/conversion.md, "The target after an exception").

// out->write( ) of an i writes it converted to a string, with the blank of its sign after it
const lines = (...l: (string | number)[]) => l.map(x => typeof x === "number" ? `${x} \n` : `${x}\n`).join("");

test("TRY: the first CATCH clause that names the class or a superclass runs; the rest of the TRY block does not", () => {
  const source = classrun(`DATA n TYPE i VALUE 5.
DATA z TYPE i.
DATA t TYPE string VALUE \`seven\`.
TRY.
    n = 1 / z.
    out->write( 'never' ).
  CATCH cx_sy_conversion_error.
    out->write( 'conversion' ).
  CATCH cx_sy_zerodivide cx_sy_arithmetic_overflow.
    out->write( 'zerodivide' ).
  CATCH cx_root.
    out->write( 'root' ).
ENDTRY.
out->write( n ).
TRY.
    n = t.
  CATCH cx_sy_arithmetic_error.
    out->write( 'arithmetic' ).
  CATCH cx_dynamic_check.
    out->write( 'dynamic check' ).
ENDTRY.
TRY.
    n = 7.
  CATCH cx_root.
    out->write( 'never' ).
ENDTRY.
out->write( n ).`);
  assert.deepEqual(run("clas", source), { stdout: lines("zerodivide", 5, "dynamic check", 7) });
});

test("TRY: an exception in a condition, a subfield and a CATCH block of an inner TRY is caught further out", () => {
  const source = classrun(`DATA n TYPE i.
DATA z TYPE i.
DATA c TYPE c LENGTH 4 VALUE 'abcd'.
DATA t TYPE string VALUE \`x\`.
TRY.
    IF n + 1 > 1 / z.
      out->write( 'never' ).
    ENDIF.
  CATCH cx_sy_zerodivide.
    out->write( 'condition' ).
ENDTRY.
n = 5.
TRY.
    c+n(1) = 'x'.
  CATCH cx_sy_range_out_of_bounds.
    out->write( 'subfield' ).
ENDTRY.
TRY.
    TRY.
        n = 1 / z.
      CATCH cx_sy_zerodivide.
        out->write( 'inner' ).
        n = t.
      CLEANUP.
        out->write( 'never: the exception comes from the CATCH block' ).
    ENDTRY.
  CATCH cx_sy_conversion_no_number.
    out->write( 'outer' ).
ENDTRY.`);
  assert.deepEqual(run("clas", source), { stdout: lines("condition", "subfield", "inner", "outer") });
});

test("CLEANUP: runs when an outer TRY catches the exception, innermost first, before the CATCH block", () => {
  const source = classrun(`DATA n TYPE i.
DATA z TYPE i.
TRY.
    TRY.
        TRY.
            n = 1 / z.
          CATCH cx_sy_conversion_error.
            out->write( 'never' ).
          CLEANUP.
            out->write( 'cleanup 1' ).
        ENDTRY.
      CLEANUP.
        out->write( 'cleanup 2' ).
    ENDTRY.
  CATCH cx_sy_arithmetic_error.
    out->write( 'caught' ).
  CLEANUP.
    out->write( 'never: caught here' ).
ENDTRY.
TRY.
    n = 1.
  CLEANUP.
    out->write( 'never: nothing raised' ).
ENDTRY.`);
  assert.deepEqual(run("clas", source), { stdout: lines("cleanup 1", "cleanup 2", "caught") });
});

test("an exception nobody catches ends the program without running a CLEANUP block", () => {
  const source = classrun(`DATA n TYPE i.
DATA z TYPE i.
out->write( 'before' ).
TRY.
    n = 1 / z.
  CATCH cx_sy_conversion_error.
    out->write( 'never' ).
  CLEANUP.
    out->write( 'never' ).
ENDTRY.`);
  const result = run("clas", source);
  assert.equal(result.stdout, lines("before"));
  assert.match(result.failed ?? "", /exception CX_SY_ZERODIVIDE not caught\n/);
});

test("an exception that leaves a CLEANUP block ends the program, even with a CATCH for it further out", () => {
  const source = classrun(`DATA n TYPE i.
DATA z TYPE i.
DATA t TYPE string VALUE \`x\`.
TRY.
    TRY.
        n = 1 / z.
      CLEANUP.
        TRY.
            n = t.
          CATCH cx_sy_conversion_no_number.
            out->write( 'handled in CLEANUP' ).
        ENDTRY.
        n = t.
        out->write( 'never' ).
    ENDTRY.
  CATCH cx_sy_zerodivide cx_sy_conversion_no_number.
    out->write( 'never' ).
ENDTRY.`);
  const result = run("clas", source);
  assert.equal(result.stdout, lines("handled in CLEANUP"));
  assert.match(result.failed ?? "", /exception CX_SY_CONVERSION_NO_NUMBER not caught in a CLEANUP block/);
});

test("RETRY runs the TRY block again", () => {
  const source = classrun(`DATA n TYPE i.
DATA z TYPE i.
TRY.
    n = n + 1.
    IF n < 3.
      n = n / z.
    ENDIF.
    out->write( n ).
  CATCH cx_sy_zerodivide.
    out->write( 'retry' ).
    DO 2 TIMES.
      RETRY.
    ENDDO.
ENDTRY.
out->write( sy-index ).`);
  assert.deepEqual(run("clas", source), { stdout: lines("retry", "retry", 3, 0) });
});

test("RETURN leaves a TRY and the processing block; no CLEANUP runs", () => {
  const source = classrun(`DATA n TYPE i.
DO 2 TIMES.
  TRY.
      TRY.
          out->write( sy-index ).
          IF sy-index = 2.
            RETURN.
          ENDIF.
        CATCH cx_root.
          out->write( 'never' ).
      ENDTRY.
    CLEANUP.
      out->write( 'never' ).
  ENDTRY.
ENDDO.
out->write( 'never' ).`);
  assert.deepEqual(run("clas", source), { stdout: lines(1, 2) });
});

test("CHECK and EXIT outside a loop leave a TRY and their START-OF-SELECTION block", () => {
  const source = `REPORT zprobe.
DATA n TYPE i.
START-OF-SELECTION.
  TRY.
      WRITE / 'first'.
      CHECK n = 1.
      WRITE / 'never'.
    CATCH cx_root.
  ENDTRY.
  WRITE / 'never'.
START-OF-SELECTION.
  TRY.
      TRY.
          WRITE / 'second'.
          EXIT.
        CATCH cx_sy_zerodivide.
      ENDTRY.
    CLEANUP.
      WRITE / 'never'.
  ENDTRY.
START-OF-SELECTION.
  WRITE / 'never'.`;
  assert.deepEqual(run("prog", source), { stdout: "first\nsecond\n" });
});

test("EXIT, CONTINUE and CHECK leave a TRY for a loop around it; no CLEANUP runs", () => {
  const source = classrun(`DATA n TYPE i.
DATA z TYPE i.
DO 4 TIMES.
  TRY.
      TRY.
          out->write( sy-index ).
          CHECK sy-index <> 1.
          IF sy-index = 3.
            EXIT.
          ENDIF.
          n = 1 / z.
        CATCH cx_sy_zerodivide.
          IF sy-index = 2.
            CONTINUE.
          ENDIF.
          out->write( 'never' ).
        CLEANUP.
          out->write( 'never' ).
      ENDTRY.
      out->write( 'never' ).
    CLEANUP.
      out->write( 'never' ).
  ENDTRY.
ENDDO.
out->write( sy-index ).
WHILE n < 2.
  n = n + 1.
  TRY.
      DO 3 TIMES.
        TRY.
            EXIT.
          CATCH cx_root.
        ENDTRY.
      ENDDO.
      out->write( sy-index ).
    CLEANUP.
  ENDTRY.
ENDWHILE.`);
  assert.deepEqual(run("clas", source), { stdout: lines(1, 2, 3, 0, 1, 2) });
});

test("sy-index after an exception leaves a loop: set back as at the end of the loop", () => {
  const source = classrun(`DATA n TYPE i.
DATA z TYPE i.
TRY.
    DO 3 TIMES.
      IF sy-index = 2.
        n = 1 / z.
      ENDIF.
    ENDDO.
  CATCH cx_sy_zerodivide.
    out->write( sy-index ).
ENDTRY.
DO 5 TIMES.
  IF sy-index = 4.
    TRY.
        TRY.
            DO 3 TIMES.
              IF sy-index = 2.
                n = 1 / z.
              ENDIF.
            ENDDO.
          CLEANUP.
            out->write( sy-index ).
        ENDTRY.
      CATCH cx_sy_zerodivide.
        out->write( sy-index ).
    ENDTRY.
    out->write( sy-index ).
    EXIT.
  ENDIF.
ENDDO.
out->write( sy-index ).`);
  assert.deepEqual(run("clas", source), { stdout: lines(0, 4, 4, 4, 0) });
});

test("the target after a caught exception: the value the conversion leaves, or the old value", () => {
  const source = classrun(`DATA i TYPE i VALUE 5.
DATA p TYPE p LENGTH 8 DECIMALS 2 VALUE 5.
DATA f TYPE f VALUE 5.
DATA n TYPE n LENGTH 4 VALUE '5'.
DATA i8 TYPE int8.
DATA d TYPE decfloat34.
DATA t TYPE string VALUE \`12abc34\`.
TRY.
    i = t.
  CATCH cx_sy_conversion_no_number.
ENDTRY.
TRY.
    p = t.
  CATCH cx_sy_conversion_no_number.
ENDTRY.
TRY.
    f = t.
  CATCH cx_sy_conversion_no_number.
ENDTRY.
i8 = 2147483647.
i8 = i8 * 2 + 3.
TRY.
    i = i8.
  CATCH cx_sy_conversion_overflow.
ENDTRY.
out->write( i ).
out->write( p ).
out->write( f ).
i = 5.
TRY.
    i = i8 * 2.
  CATCH cx_sy_conversion_overflow.
ENDTRY.
out->write( i ).
t = \`12345.678\`.
d = t.
TRY.
    n = d.
  CATCH cx_sy_conversion_overflow.
ENDTRY.
out->write( n ).
TRY.
    n+1(3) = d.
  CATCH cx_sy_conversion_overflow.
ENDTRY.
out->write( n ).
i = 5.
TRY.
    i = i + 2147483647.
  CATCH cx_sy_arithmetic_overflow.
ENDTRY.
out->write( i ).`);
  // the subfield n+1(3) is an n of length 3, which 12345.678 does not fit: kept
  // an int8 result keeps an i result field, unlike the conversion of an int8 data object
  assert.deepEqual(run("clas", source), { stdout: lines(1, "0.00 ", "1.2000000000000000E+01", 5, "1E+4", "1E+4", 5) });
});

// An exception to the guiding principle (docs/aot_for_abap.md): ABAP runs the CLEANUP and CATCH blocks below with
// the special value in the target; the runtime cannot hold or use it yet, so it ends the program before them.
test("a special value left in a target that a CATCH could read is a runtime error naming the gap", () => {
  const caught = run("clas", classrun(`DATA f TYPE f.
DATA t TYPE string VALUE \`1E400\`.
TRY.
    f = t.
  CATCH cx_sy_conversion_overflow.
    out->write( 'caught' ).
ENDTRY.`));
  assert.equal(caught.stdout, "");
  assert.match(caught.failed ?? "", /SPECIAL_VALUE_NOT_SUPPORTED: exception CX_SY_CONVERSION_OVERFLOW leaves \+Inf, -Inf or NaN in an f field/);
  const decfloat16 = run("clas", classrun(`DATA d16 TYPE decfloat16.
DATA d34 TYPE decfloat34.
DATA t TYPE string VALUE \`1E400\`.
d34 = t.
TRY.
    TRY.
        d16 = d34.
      CLEANUP.
        out->write( 'cleanup' ).
    ENDTRY.
  CATCH cx_sy_conversion_error.
    out->write( 'caught' ).
ENDTRY.`));
  assert.equal(decfloat16.stdout, "");
  assert.match(decfloat16.failed ?? "", /SPECIAL_VALUE_NOT_SUPPORTED: .* an infinity in a decfloat16 field/);
  // nothing can read the target when nothing catches the exception
  const uncaught = run("clas", classrun(`DATA f TYPE f.
DATA t TYPE string VALUE \`1E400\`.
TRY.
    f = t.
  CATCH cx_sy_zerodivide.
ENDTRY.`));
  assert.match(uncaught.failed ?? "", /exception CX_SY_CONVERSION_OVERFLOW not caught/);
});

test("TRY: what is refused", () => {
  const refused = (body: string) => run("clas", classrun(`DATA n TYPE i.
${body}`)).refused ?? "";
  assert.match(refused(`TRY.
    n = 1.
  CATCH cx_root INTO DATA(o).
ENDTRY.`), /CATCH \.\.\. INTO is not supported yet/);
  assert.match(refused(`TRY.
    n = 1.
  CATCH BEFORE UNWIND cx_root.
ENDTRY.`), /CATCH BEFORE UNWIND is not supported yet/);
  assert.match(refused(`TRY.
    n = 1.
  CATCH if_oo_adt_classrun.
ENDTRY.`), /do not pass the syntax check[\s\S]*IF_OO_ADT_CLASSRUN is an interface/);
  // ABAP syntax errors
  assert.match(refused(`TRY.
    RETRY.
  CATCH cx_root.
ENDTRY.`), /do not pass the syntax check[\s\S]*RETRY is only allowed in a CATCH block/);
  assert.match(refused(`TRY.
    n = 1.
  CATCH cx_root.
    TRY.
        n = 2.
      CLEANUP.
        RETRY.
    ENDTRY.
ENDTRY.`), /do not pass the syntax check[\s\S]*RETRY is only allowed in a CATCH block/);
  for (const leave of ["RETURN.", "EXIT.", "CONTINUE.", "CHECK n = 1."]) {
    assert.match(refused(`DO 2 TIMES.
  TRY.
      n = 1.
    CLEANUP.
      ${leave}
  ENDTRY.
ENDDO.`), /do not pass the syntax check/);
  }
  assert.match(refused(`TRY.
    n = 1.
  CATCH cx_sy_arithmetic_error.
  CATCH cx_sy_zerodivide.
ENDTRY.`), /CX_SY_ZERODIVIDE after the CATCH of its superclass/);
  // valid ABAP, but not in the built-in library: the runtime never raises it, and a CATCH of a class outside the
  // world is unknown
  assert.match(refused(`TRY.
    n = 1.
  CATCH cx_sy_precision_loss.
ENDTRY.`), /unknown class CX_SY_PRECISION_LOSS/);
});

// ABAP is expected to give only a warning for it
test("TRY without CATCH or CLEANUP runs its block, and an exception in it is not caught", () => {
  const result = run("clas", classrun(`DATA n TYPE i.
TRY.
    n = 1.
    out->write( n ).
ENDTRY.
TRY.
ENDTRY.
TRY.
    n = n / 0.
ENDTRY.
out->write( 'after' ).`));
  assert.equal(result.refused, undefined, result.refused);
  assert.equal(result.stdout, "1 \n");
  assert.match(result.failed ?? "", /exception CX_SY_ZERODIVIDE not caught/);
});
