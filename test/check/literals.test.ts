import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classrun, syntaxCheck } from "../harness";

// A number literal is expected to have at most 31 digits; leading zeros count, the sign does not.

const DIGITS_31 = "1234567890123456789012345678901";

const tooLong: [string, string, string][] = [
  ["32 digits", `DATA r TYPE p LENGTH 16.\nr = 1${DIGITS_31}.`, `1${DIGITS_31}`],
  ["31 digits after a leading zero", `DATA r TYPE p LENGTH 16.\nr = 0${DIGITS_31}.`, `0${DIGITS_31}`],
  ["32 digits with a sign", `DATA r TYPE p LENGTH 16.\nr = -1${DIGITS_31}.`, `1${DIGITS_31}`],
  ["32 digits in a comparison", `DATA r TYPE p LENGTH 16.\nIF r = 1${DIGITS_31}.\nENDIF.`, `1${DIGITS_31}`],
  ["32 digits as VALUE", `DATA r TYPE p LENGTH 16 VALUE 1${DIGITS_31}.`, `1${DIGITS_31}`],
];
for (const [name, body, literal] of tooLong) {
  test(`number literal refused: ${name}`, () => {
    const findings = syntaxCheck("clas", classrun(body));
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], new RegExp(`: the number literal ${literal} has more than 31 digits \\[number_literal_length\\]$`));
  });
}

test("number literal refused in a report", () => {
  assert.deepEqual(syntaxCheck("prog", `REPORT zprobe.\nDATA r TYPE p LENGTH 16.\nr = 1${DIGITS_31}.`),
    [`3:5: the number literal 1${DIGITS_31} has more than 31 digits [number_literal_length]`]);
});

const accepted: [string, string][] = [
  ["31 digits", `DATA r TYPE p LENGTH 16.\nr = ${DIGITS_31}.`],
  ["30 digits after a leading zero", `DATA r TYPE p LENGTH 16.\nr = 0${DIGITS_31.slice(1)}.`],
  ["31 digits with a sign", `DATA r TYPE p LENGTH 16.\nr = -${DIGITS_31}.`],
];
for (const [name, body] of accepted) {
  test(`number literal accepted: ${name}`, () => {
    assert.deepEqual(syntaxCheck("clas", classrun(body)), []);
  });
}
