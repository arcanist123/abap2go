import { test } from "node:test";
import * as assert from "node:assert/strict";
import { syntaxCheck } from "../harness";

// In a Unicode program an offset or length on a structure is expected to stay within the character-like initial part
// of a flat structure.

const DECL = `REPORT zprobe.
DATA c TYPE c LENGTH 20.
DATA i TYPE i.
CONSTANTS far TYPE i VALUE 20.
DATA: BEGIN OF flat, a TYPE c LENGTH 4, BEGIN OF inner, b TYPE n LENGTH 4, END OF inner, e TYPE d, END OF flat.
DATA: BEGIN OF mixed, a TYPE c LENGTH 2, BEGIN OF inner, b TYPE c LENGTH 2, e TYPE i, END OF inner, g TYPE c, END OF mixed.
DATA: BEGIN OF number, a TYPE i, b TYPE c LENGTH 4, END OF number.
DATA: BEGIN OF deep, a TYPE c LENGTH 4, b TYPE string, END OF deep.
DATA header LIKE STANDARD TABLE OF mixed WITH HEADER LINE.`;
const FIRST = DECL.split("\n").length + 1;

const NO_PART = "A structure without a character-like initial part cannot be accessed with an offset or length";
const DEEP = "A deep structure cannot be accessed with an offset or length";
const offset = (value: number, max: number) =>
  `the offset ${value} is not within the character-like initial part of length ${max}`;
const exceed = (max: number) => `the offset and length exceed the character-like initial part of length ${max}`;
const rest = (max: number) => `the access to the end of the structure exceeds its character-like initial part of length ${max}`;

const wrong: [string, string][] = [
  ["c = flat(17).", exceed(16)],
  ["c = flat+15(2).", exceed(16)],
  ["c = flat+i(17).", exceed(16)],
  ["c = flat(far).", exceed(16)],
  ["c = flat+16.", offset(16, 16)],
  ["c = flat+20(i).", offset(20, 16)],
  ["flat+16(i) = c.", offset(16, 16)],
  ["c = mixed+0.", rest(4)],
  ["c = mixed(*).", rest(4)],
  ["mixed+0(*) = c.", rest(4)],
  ["c = mixed+1(*).", rest(4)],
  ["c = header(5).", exceed(4)],
  ["c = number(1).", NO_PART],
  ["c = number+i.", NO_PART],
  ["number+0 = c.", NO_PART],
  ["number+0(4) = c.", NO_PART],
  ["CONDENSE number(4).", NO_PART],
  ["deep+0(2) = c.", DEEP],
];

test("offsets and lengths a structure does not allow", () => {
  const findings = syntaxCheck("prog", [DECL, ...wrong.map(([statement]) => statement)].join("\n"));
  assert.deepEqual(findings.map(f => f.replace(/:\d+:/, ":")).sort(),
    wrong.map(([, message], i) => `${FIRST + i}: ${message} [structure_offset]`).sort());
});

// forms of the same rules that abaplint reports; its findings stop layer 2 for the object
test("offsets and lengths that abaplint reports", () => {
  const findings = syntaxCheck("prog", [DECL, "c = mixed(5).", "c = mixed+4(1).", "c = deep(4)."].join("\n"));
  assert.deepEqual(findings.map(f => f.replace(/:\d+:/, ":")), [
    `${FIRST}: Length 5 exceeds the character-like initial part of length 4 of the structure [check_syntax]`,
    `${FIRST + 1}: Offset 4 exceeds the character-like initial part of length 4 of the structure [check_syntax]`,
    `${FIRST + 2}: Incompatible types [check_syntax]`,
  ]);
});

test("offsets and lengths within the character-like initial part", () => {
  assert.deepEqual(syntaxCheck("prog", [DECL,
    "c = flat(16).", "c = flat+15.", "c = flat+0.", "c = flat(*).", "c = flat+i(16).", "c = flat+i(i).", "flat+15(1) = c.",
    "c = mixed(4).", "c = mixed+3(1).", "c = mixed+0(4).", "c = mixed+i.", "c = mixed+i(*).", "c = mixed(i).",
    "mixed+0(2) = c.", "c = header(4).", "c = mixed-a+1.", "c = deep-a(2).",
  ].join("\n")), []);
});
