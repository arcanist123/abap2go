import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classrun, syntaxCheck } from "../harness";

// CONTINUE is expected to be a syntax error outside DO, WHILE, LOOP and SELECT, in every processing block.

const outside: [string, string][] = [
  ["in IF", "IF 1 = 1.\nCONTINUE.\nENDIF."],
  ["alone", "CONTINUE."],
  ["after a loop", "DO 1 TIMES.\nENDDO.\nCONTINUE."],
];
for (const [name, body] of outside) {
  test(`CONTINUE outside a loop, ${name}, in a method`, () => {
    const findings = syntaxCheck("clas", classrun(body));
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], /: CONTINUE is only possible in a loop \[continue_outside_loop\]$/);
  });
  test(`CONTINUE outside a loop, ${name}, in a report`, () => {
    assert.deepEqual(syntaxCheck("prog", `REPORT zprobe.\n${body}`).map(f => f.replace(/^\d+:\d+: /, "")),
      ["CONTINUE is only possible in a loop [continue_outside_loop]"]);
  });
}

test("CONTINUE outside a loop, in a FORM", () => {
  assert.deepEqual(syntaxCheck("prog", "REPORT zprobe.\nSTART-OF-SELECTION.\nPERFORM f.\nFORM f.\nCONTINUE.\nENDFORM."),
    ["5:1: CONTINUE is only possible in a loop [continue_outside_loop]"]);
});

const inside: [string, string][] = [
  ["DO", "DO 1 TIMES.\nCONTINUE.\nENDDO."],
  ["WHILE, nested in IF", "DATA i TYPE i.\nWHILE i < 1.\nIF i = 0.\nCONTINUE.\nENDIF.\nENDWHILE."],
  ["LOOP", "DATA tab TYPE STANDARD TABLE OF i WITH EMPTY KEY.\nLOOP AT tab INTO DATA(i).\nCONTINUE.\nENDLOOP."],
  ["CASE in DO", "DO 1 TIMES.\nCASE sy-index.\nWHEN 1.\nCONTINUE.\nENDCASE.\nENDDO."],
];
for (const [name, body] of inside) {
  test(`CONTINUE in a loop: ${name}`, () => {
    assert.deepEqual(syntaxCheck("clas", classrun(body)), []);
  });
}
