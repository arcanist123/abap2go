import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classrun, run } from "./harness";

// What the lowering cannot compile yet is reported all at once: every statement, every part of a control structure and
// every operand is looked at, also after one that is not compiled (docs/aot_for_abap.md, "Four kinds of refusal").
// Nothing here builds, so these tests need no Go.

const HEADING = "the root uses ABAP that abap2go does not compile yet:";

/** The findings of a refused root as `row: message`, or `message` for one without a position, in their order. */
function findings(kind: "prog" | "clas", source: string): string[] {
  const result = run(kind, source);
  assert.ok(result.refused !== undefined, `built, stdout ${JSON.stringify(result.stdout)}`);
  const [heading, ...lines] = result.refused.split("\n");
  assert.equal(heading, HEADING, result.refused);
  return lines.map(line => line.replace(/^.*?\.abap:(\d+):\d+: /, "$1: "));
}

/** A report whose body starts at row 2. */
const report = (...body: string[]) => findings("prog", ["REPORT zprobe.", ...body].join("\n"));

/** Asserts that the findings are, in this order, at these rows and match these patterns. */
function expect(actual: string[], expected: [number, RegExp][]): void {
  const shown = actual.join("\n");
  assert.deepEqual(actual.map(f => Number(/^(\d+):/.exec(f)?.[1])), expected.map(e => e[0]), shown);
  expected.forEach(([, pattern], k) => assert.match(actual[k], pattern, shown));
}

test("not compiled yet: every statement of every block", () => {
  expect(report(
    "DATA i TYPE i.",
    "CLEAR i.",
    "i = 1.",
    "ADD 1 TO i.",
    "START-OF-SELECTION.",
    "WRITE 'a' COLOR 1.",
    "START-OF-SELECTION.",
    "CLEAR i.",
  ), [
    [3, /statement Clear is not compiled yet/],
    [5, /statement Add is not compiled yet/],
    [7, /only WRITE/],
    [9, /statement Clear is not compiled yet/],
  ]);
});

test("not compiled yet: the conditions and blocks of IF", () => {
  expect(report(
    "DATA i TYPE i.",
    "IF i IS INITIAL.",
    "  CLEAR i.",
    "ELSEIF i IS NOT INITIAL.",
    "  CLEAR i.",
    "ELSE.",
    "  CLEAR i.",
    "ENDIF.",
  ), [
    [3, /not IS, IN or other predicates/],
    [4, /statement Clear/],
    [5, /not IS, IN or other predicates/],
    [6, /statement Clear/],
    [8, /statement Clear/],
  ]);
});

test("not compiled yet: CASE, its operand, the statements before WHEN, the values and the blocks", () => {
  expect(report(
    "DATA i TYPE i.",
    "CASE sign( i ).",
    "  CLEAR i.",
    "  WHEN sign( 1 ) OR sign( 2 ).",
    "    CLEAR i.",
    "  WHEN OTHERS.",
    "    CLEAR i.",
    "ENDCASE.",
  ), [
    [3, /sign\( i \)/],
    [4, /statement Clear/],
    [5, /sign\( 1 \)/],
    [5, /sign\( 2 \)/],
    [6, /statement Clear/],
    [8, /statement Clear/],
  ]);
});

test("not compiled yet: DO and WHILE", () => {
  expect(report(
    "DATA i TYPE i.",
    "DATA j TYPE i.",
    "DATA k TYPE i.",
    "DO sign( i ) TIMES.",
    "  CLEAR i.",
    "ENDDO.",
    "WHILE i IS INITIAL VARY i FROM j NEXT k.",
    "  CLEAR i.",
    "ENDWHILE.",
  ), [
    [5, /sign\( i \)/],
    [6, /statement Clear/],
    [8, /VARY is not compiled yet/],
    [8, /not IS, IN or other predicates/],
    [9, /statement Clear/],
  ]);
});

test("not compiled yet: TRY, CATCH and CLEANUP", () => {
  expect(report(
    "DATA i TYPE i.",
    "TRY.",
    "    TRY.",
    "        CLEAR i.",
    "      CATCH BEFORE UNWIND cx_sy_zerodivide INTO DATA(x).",
    "        CLEAR i.",
    "      CLEANUP INTO DATA(y).",
    "        CLEAR i.",
    "    ENDTRY.",
    "  CATCH cx_root.",
    "    CLEAR i.",
    "ENDTRY.",
  ), [
    [5, /statement Clear/],
    [6, /BEFORE UNWIND/],
    [6, /CATCH \.\.\. INTO/],
    [7, /statement Clear/],
    [8, /CLEANUP INTO/],
    [9, /statement Clear/],
    [12, /statement Clear/],
  ]);
});

test("not compiled yet: a structure that is not compiled, and what its blocks lack", () => {
  expect(report(
    "DATA i TYPE i.",
    "DATA itab TYPE STANDARD TABLE OF i.",
    "LOOP AT itab INTO i.",
    "  i = i + 1.",
    "  IF i = 1.",
    "    CLEAR i.",
    "  ENDIF.",
    "ENDLOOP.",
    "FORM f.",
    "  CLEAR i.",
    "ENDFORM.",
  ), [
    // the declaration of the table
    [3, /itab: type .* is not compiled yet/],
    [4, /Loop is not compiled yet/],
    [7, /statement Clear/],
    [10, /Form is not compiled yet/],
    [11, /statement Clear/],
  ]);
});

test("not compiled yet: both sides of a logical expression and of a comparison", () => {
  expect(report(
    "DATA i TYPE i.",
    "ASSERT i IS INITIAL AND ( i CO 'a' OR sign( 1 ) = sign( 2 ) ).",
    "ASSERT sign( 3 ) BETWEEN sign( 4 ) AND 5.",
  ), [
    [3, /not IS, IN or other predicates/],
    [3, /the operator CO is not compiled yet/],
    [3, /sign\( 1 \)/],
    [3, /sign\( 2 \)/],
    // the operand of BETWEEN is compared twice and reported once
    [4, /sign\( 3 \)/],
    [4, /sign\( 4 \)/],
  ]);
});

test("not compiled yet: the target, the operands, function arguments and subfield bounds", () => {
  expect(report(
    "DATA i TYPE i.",
    "DATA c TYPE c LENGTH 8.",
    "DATA ref TYPE REF TO i.",
    "DATA x TYPE x LENGTH 2.",
    "ref->* = sign( i ).",
    "i = sign( 1 ) + i * sign( 2 ) - ipow( base = sign( 3 ) exp = sign( 4 ) ).",
    "x = x BIT-AND x.",
    "c+sy-subrc = c(sy-fdpos).",
  ), [
    [4, /ref: type .* is not compiled yet/],
    [6, /ref->\*: only a variable or a subfield is compiled as target yet/],
    [6, /sign\( i \)/],
    [7, /sign\( 1 \)/],
    [7, /sign\( 2 \)/],
    [7, /sign\( 3 \)/],
    [7, /sign\( 4 \)/],
    [8, /x BIT-AND x: not compiled in an arithmetic expression yet/],
    [9, /c\+sy-subrc: only an integer or a variable/],
    [9, /c\(sy-fdpos\): only an integer or a variable/],
  ]);
});

test("not compiled yet: a class root and the statements of its method", () => {
  const source = classrun(`DATA i TYPE i.
CLEAR i.
out->write( data = sign( 1 ) name = sign( 2 ) ).`).replace("INTERFACES if_oo_adt_classrun.",
    "INTERFACES if_oo_adt_classrun.\n    METHODS constructor.").replace("CLASS zcl_probe IMPLEMENTATION.",
    "CLASS zcl_probe IMPLEMENTATION.\n  METHOD constructor.\n  ENDMETHOD.");
  const [root, ...rest] = findings("clas", source);
  assert.equal(root, "root ZCL_PROBE: CONSTRUCTOR is not compiled yet");
  assert.equal(rest.length, 3, rest.join("\n"));
  assert.match(rest[0], /statement Clear/);
  assert.match(rest[1], /sign\( 1 \)/);
  assert.match(rest[2], /sign\( 2 \)/);
});
