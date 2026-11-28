import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classrun, run, syntaxCheck } from "../harness";

// A statement that reads as either an internal table or a database table statement is refused as out of scope,
// even where the type of the name would decide it (docs/abaplint_ambiguous_parsing.md).

const decl = "DATA itab TYPE STANDARD TABLE OF i WITH EMPTY KEY.\nDATA wa TYPE i.\n";

const ambiguous: [string, string][] = [
  ["DELETE itab FROM 2", "DELETE itab FROM 2."],
  ["DELETE itab FROM wa", "DELETE itab FROM wa."],
  ["MODIFY itab FROM wa", "MODIFY itab FROM wa."],
];
for (const [name, statement] of ambiguous) {
  test(`ambiguous statement refused: ${name}`, () => {
    const findings = syntaxCheck("clas", classrun(decl + statement));
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], /\[ambiguous_statement\]$/);
  });
}

test("ambiguous statement: reported as not supported, not as a syntax error", () => {
  const { refused } = run("clas", classrun(decl + "DELETE itab FROM 2."));
  assert.ok(refused !== undefined);
  assert.match(refused, /^the packages use ABAP that abap2go does not support:\n.*\[ambiguous_statement\]$/);
});

test("ambiguous statement: layer 2 still checks the object", () => {
  const { refused } = run("clas", classrun(decl + "DELETE itab FROM 2.\nCONTINUE."));
  assert.ok(refused !== undefined);
  assert.match(refused, /^the packages do not pass the syntax check:\n.*\[continue_outside_loop\]\n/);
  assert.match(refused, /\nthe packages use ABAP that abap2go does not support:\n.*\[ambiguous_statement\]$/);
});

test("explicit form accepted: DELETE TABLE itab FROM wa", () => {
  assert.deepEqual(syntaxCheck("clas", classrun(decl + "DELETE TABLE itab FROM wa.")), []);
});
