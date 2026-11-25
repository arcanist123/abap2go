import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classrun, run } from "./harness";

// ASSERT with one comparison, on the comparison rules of docs/spec/comparison.md. When the condition does not hold
// the program ends with the runtime error ASSERTION_FAILED; what was written before stays written.

test("ASSERT: every relational operator, in each of its forms, when the comparison holds", () => {
  const source = `DATA a TYPE i VALUE 2.
DATA b TYPE p LENGTH 8 DECIMALS 2 VALUE '2.5'.
ASSERT a = 2. ASSERT a EQ 2.
ASSERT a <> b. ASSERT a NE b. ASSERT a >< b.
ASSERT a < b. ASSERT a LT b.
ASSERT b > a. ASSERT b GT a.
ASSERT a <= 2. ASSERT a LE b. ASSERT a =< b.
ASSERT b >= a. ASSERT b GE 2. ASSERT b => a.
WRITE 'done'.`;
  assert.deepEqual(run("prog", source), { stdout: "done\n" });
});

test("ASSERT: operands are compared in their comparison type", () => {
  const source = `DATA n TYPE n LENGTH 5 VALUE '00010'.
DATA c TYPE c LENGTH 4 VALUE ' 10'.
DATA s TYPE string VALUE \`ab \`.
DATA f TYPE f.
f = 1 / 5.
ASSERT n = c.
ASSERT n = 10.
ASSERT 'ab' = 'ab  '.
ASSERT s <> 'ab'.
ASSERT f = '0.2'.
ASSERT n(4) = '0001'.`;
  assert.deepEqual(run("prog", source), { stdout: "" });
});

test("ASSERT: a number literal beyond the range of i is a p, in moves, VALUE and comparisons", () => {
  const source = `DATA a TYPE int8 VALUE 9007199254740993.
DATA b TYPE int8.
b = -9223372036854775808.
ASSERT a = 9007199254740993.
ASSERT a > 9007199254740992.
ASSERT b = -9223372036854775808.
ASSERT b < -2147483649.`;
  assert.deepEqual(run("prog", source), { stdout: "" });
});

test("ASSERT: a condition that does not hold ends the program with ASSERTION_FAILED", () => {
  // the line of 'open' is not finished when the program ends, so only the first line is output
  const result = run("prog", "WRITE 'before'.\nWRITE / 'open'.\nDATA a TYPE i VALUE 3.\nASSERT a = 4.\nWRITE / 'after'.");
  assert.equal(result.stdout, "before\n");
  assert.match(result.failed ?? "", /ASSERTION_FAILED/);
});

test("ASSERT: a text that is no number in a numeric comparison is the runtime error CONVT_NO_NUMBER", () => {
  const result = run("prog", "DATA n TYPE n LENGTH 5 VALUE '00010'.\nDATA t TYPE c LENGTH 3 VALUE 'x10'.\nASSERT n = t.");
  assert.match(result.failed ?? "", /CONVT_NO_NUMBER/);
});

test("ASSERT in a classrun", () => {
  const result = run("clas", classrun("DATA a TYPE i. a = 7 DIV 2. ASSERT a = 3. out->write( 'ok' ). ASSERT a = 4. out->write( 'not reached' )."));
  assert.equal(result.stdout, "ok\n");
  assert.match(result.failed ?? "", /ASSERTION_FAILED/);
});

const refusals: [string, string, RegExp][] = [
  ["NOT", "DATA a TYPE i.\nASSERT NOT a = 1.", /no NOT, AND, OR|not NOT or other predicates/],
  ["AND", "DATA a TYPE i.\nASSERT a = 0 AND a < 1.", /only one comparison/],
  ["BETWEEN", "DATA a TYPE i.\nASSERT a BETWEEN 0 AND 1.", /only a comparison with/],
  ["IS INITIAL", "DATA a TYPE i.\nASSERT a IS INITIAL.", /only a comparison with/],
  ["an arithmetic operand", "ASSERT 4 - 0 + 1 = 5.", /arithmetic expressions and functions as operands of a comparison/],
  ["a function operand", "DATA s TYPE string.\nASSERT strlen( s ) = 0.", /arithmetic expressions and functions as operands of a comparison/],
  ["FIELDS", "DATA a TYPE i.\nASSERT FIELDS a CONDITION a = 0.", /no additions/],
];
for (const [name, source, refused] of refusals) {
  test(`ASSERT refused: ${name}`, () => {
    const result = run("prog", source);
    assert.ok(result.refused !== undefined, `built, stdout ${JSON.stringify(result.stdout)}`);
    assert.match(result.refused, refused);
  });
}
