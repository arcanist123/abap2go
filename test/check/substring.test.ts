import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classrun, syntaxCheck } from "../harness";

// Static bounds outside a field of type n, d or t are expected to be syntax errors, as for c and x: a static offset
// without a length must lie inside the field, a static offset (0 if none) and a static length too. A variable offset
// or length leaves them to the run time, a constant counts as static.

const DECLARATIONS = `DATA n4 TYPE n LENGTH 4.
DATA d TYPE d.
DATA t TYPE t.
DATA off TYPE i.
DATA s TYPE string.
CONSTANTS k3 TYPE i VALUE 3.
CONSTANTS k4 TYPE i VALUE 4.
DATA: BEGIN OF st,
        d TYPE d,
      END OF st.
`;

const outside: [string, string, string][] = [
  ["an offset at the end of an n", "s = n4+4.", "the offset 4 is not within the length 4"],
  ["an offset and length beyond an n", "s = n4+3(2).", "the offset 3 and length 2 exceed the length 4"],
  ["a length beyond an n", "s = n4(5).", "the offset 0 and length 5 exceed the length 4"],
  ["an offset at the end of a d", "s = d+8.", "the offset 8 is not within the length 8"],
  ["an offset at the end of a d with a length", "s = d+8(1).", "the offset 8 and length 1 exceed the length 8"],
  ["a length beyond a d", "s = d(9).", "the offset 0 and length 9 exceed the length 8"],
  ["an offset and length beyond a t", "s = t+5(2).", "the offset 5 and length 2 exceed the length 6"],
  ["an offset at the end of a t, as target", "t+6 = 'a'.", "the offset 6 is not within the length 6"],
  ["a constant offset", "s = n4+k4.", "the offset 4 is not within the length 4"],
  ["a constant length", "s = n4+2(k3).", "the offset 2 and length 3 exceed the length 4"],
  ["a component of type d", "s = st-d+7(2).", "the offset 7 and length 2 exceed the length 8"],
  ["in a comparison", "IF n4+4 = '1'.\nENDIF.", "the offset 4 is not within the length 4"],
  ["in WRITE", "WRITE d+8.", "the offset 8 is not within the length 8"],
];
for (const [name, body, message] of outside) {
  test(`substring bounds refused: ${name}`, () => {
    const findings = syntaxCheck("prog", `REPORT zprobe.\n${DECLARATIONS}${body}`);
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], new RegExp(`^${DECLARATIONS.split("\n").length + 1}:\\d+: ${message} \\[substring_bounds\\]$`));
  });
}

test("substring bounds refused in a method", () => {
  const findings = syntaxCheck("clas", classrun(DECLARATIONS + "s = n4+4."));
  assert.equal(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /: the offset 4 is not within the length 4 \[substring_bounds\]$/);
});

const inside: [string, string][] = [
  ["the last digit of an n", "s = n4+3(1)."],
  ["the whole d", "s = d(8)."],
  ["the last digit of a t", "s = t+5."],
  ["a constant offset inside", "s = n4+k3."],
  ["a component inside", "s = st-d+6(2)."],
  ["a variable length after the end", "s = n4+4(off)."],
  ["a variable offset with a length beyond", "s = n4+off(5)."],
];
for (const [name, body] of inside) {
  test(`substring bounds accepted: ${name}`, () => {
    assert.deepEqual(syntaxCheck("prog", `REPORT zprobe.\n${DECLARATIONS}${body}`), []);
  });
}
