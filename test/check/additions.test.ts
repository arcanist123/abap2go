import { test } from "node:test";
import * as assert from "node:assert/strict";
import { syntaxCheck } from "../harness";

// The additions a Unicode program is expected to require, which a program that is not Unicode may leave out.

const DECL = ["REPORT zprobe.", "DATA c TYPE c LENGTH 10.", "DATA i TYPE i.", "DATA j TYPE i.", "DATA f TYPE string."];

const LENGTH = "DESCRIBE FIELD ... LENGTH needs IN BYTE MODE or IN CHARACTER MODE";
const DISTANCE = "DESCRIBE DISTANCE needs IN BYTE MODE or IN CHARACTER MODE";
const FOR = "OPEN DATASET needs FOR INPUT, OUTPUT, APPENDING or UPDATE";
const MODE = "OPEN DATASET needs IN ... MODE";
const ENCODING = "OPEN DATASET ... IN TEXT MODE needs ENCODING";

const missing: [string, string][] = [
  ["DESCRIBE FIELD c LENGTH i.", LENGTH],
  ["DESCRIBE FIELD c TYPE c LENGTH i.", LENGTH],
  ["DESCRIBE FIELD c LENGTH i OUTPUT-LENGTH j.", LENGTH],
  ["DESCRIBE FIELD: c LENGTH i IN CHARACTER MODE, f LENGTH j.", LENGTH],
  ["DESCRIBE DISTANCE BETWEEN i AND j INTO i.", DISTANCE],
  ["OPEN DATASET f.", FOR],
  ["OPEN DATASET f IN BINARY MODE.", FOR],
  ["OPEN DATASET f MESSAGE f.", FOR],
  ["OPEN DATASET f FOR INPUT.", MODE],
  ["OPEN DATASET f FOR OUTPUT AT POSITION 1.", MODE],
  ["OPEN DATASET f FOR INPUT IN TEXT MODE.", ENCODING],
  ["OPEN DATASET f FOR INPUT IN TEXT MODE CODE PAGE f.", ENCODING],
];

test("a missing addition of DESCRIBE and OPEN DATASET", () => {
  const findings = syntaxCheck("prog", [...DECL, ...missing.map(([statement]) => statement)].join("\n"));
  // the second statement of the chain starts at its own field
  const expected = missing.map(([statement, message], i) =>
    `${DECL.length + i + 1}:1: ${message} [unicode_addition]`);
  assert.deepEqual(findings.map(f => f.replace(/:\d+:/, ":1:")).sort(), expected.sort());
});

const complete = [
  "DESCRIBE FIELD c LENGTH i IN CHARACTER MODE.",
  "DESCRIBE FIELD c LENGTH i IN BYTE MODE TYPE c.",
  "DESCRIBE FIELD c TYPE c.",
  "DESCRIBE FIELD c OUTPUT-LENGTH i.",
  "DESCRIBE FIELD c DECIMALS i.",
  "DESCRIBE DISTANCE BETWEEN i AND j INTO i IN BYTE MODE.",
  "OPEN DATASET f FOR INPUT IN BINARY MODE.",
  "OPEN DATASET f IN BINARY MODE FOR APPENDING.",
  "OPEN DATASET f FOR OUTPUT IN TEXT MODE ENCODING DEFAULT.",
  "OPEN DATASET f FOR UPDATE IN TEXT MODE ENCODING UTF-8 WITH SMART LINEFEED.",
  "OPEN DATASET f FOR INPUT IN LEGACY TEXT MODE.",
  "OPEN DATASET f FOR INPUT IN LEGACY BINARY MODE CODE PAGE f.",
];

test("DESCRIBE and OPEN DATASET with their additions", () => {
  assert.deepEqual(syntaxCheck("prog", [...DECL, ...complete].join("\n")), []);
});
