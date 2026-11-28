import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { classrun, dtel, syntaxCheck } from "../harness";

// The literal of a VALUE addition is expected to be a syntax error when its conversion to the type of the data object
// would raise an exception. The same literal in a move is valid code, which raises when it runs.

const TABLE = path.join(__dirname, "..", "..", "..", "runtime", "go", "abap", "testdata", "value_literal.tsv");

/** b and s come from DDIC INT1 and INT2. */
const DTELS = {
  ...dtel("ZBYTE", "<DATATYPE>INT1</DATATYPE><LENG>000003</LENG><OUTPUTLEN>000003</OUTPUTLEN>"),
  ...dtel("ZSHORT", "<DATATYPE>INT2</DATATYPE><LENG>000005</LENG><OUTPUTLEN>000006</OUTPUTLEN>"),
};

/** The ABAP type of a cell's type name: b, s, pL.D, cN, nN, xN or the name itself. */
function abapType(name: string): string {
  const packed = /^p(\d+)\.(\d+)$/.exec(name);
  const sized = /^([cnx])(\d+)$/.exec(name);
  if (packed !== null) {
    return `p LENGTH ${packed[1]} DECIMALS ${packed[2]}`;
  } else if (sized !== null) {
    return `${sized[1]} LENGTH ${sized[2]}`;
  }
  return name === "b" ? "zbyte" : name === "s" ? "zshort" : name;
}

const cells = fs.readFileSync(TABLE, "utf-8").split(/\r?\n/)
  .filter(line => line !== "" && !line.startsWith("#"))
  .map(line => line.split("\t"));

test("VALUE literals: every cell of value_literal.tsv", () => {
  // one program with a declaration per cell, on line 2 onwards
  const source = ["REPORT zprobe.",
    ...cells.map(([type, literal], i) => `DATA v${i} TYPE ${abapType(type)} VALUE ${literal}.`)].join("\n");
  const refused = new Set<number>();
  for (const finding of syntaxCheck("prog", source, DTELS)) {
    const match = /^(\d+):\d+: the VALUE .* \[value_literal\]$/.exec(finding);
    assert.ok(match, finding);
    refused.add(Number(match[1]) - 2);
  }
  const differences = cells.flatMap(([type, literal, expected], i) =>
    (refused.has(i) ? "error" : "ok") === expected ? [] : [`${type} VALUE ${literal}: expected ${expected}`]);
  assert.ok(cells.length > 3000, `${cells.length} cells`);
  assert.deepEqual(differences.slice(0, 40), [], `${differences.length} of ${cells.length} cells differ`);
});

test("VALUE literal refused: the position and the name", () => {
  assert.deepEqual(syntaxCheck("prog", "REPORT zprobe.\nDATA r TYPE i VALUE 'abc'."),
    ["2:21: the VALUE 'abc' cannot be converted to the type of r [value_literal]"]);
});

const refused: [string, string][] = [
  ["CONSTANTS", "CONSTANTS r TYPE i VALUE 3000000000."],
  ["a negative number", "DATA r TYPE zbyte VALUE -1."],
  ["a type of the program", "TYPES ty TYPE i.\nDATA r TYPE ty VALUE 'abc'."],
  ["LIKE", "DATA w TYPE i.\nDATA r LIKE w VALUE 'abc'."],
  ["p with its length in parentheses", "DATA r(2) TYPE p VALUE 1000."],
  ["a component", "DATA: BEGIN OF s,\n  r TYPE i VALUE 'abc',\nEND OF s."],
  ["a nested component", "DATA: BEGIN OF s,\n  BEGIN OF t,\n    r TYPE i VALUE 'abc',\n  END OF t,\nEND OF s."],
  ["a component of a constant", "CONSTANTS: BEGIN OF s,\n  r TYPE i VALUE 'abc',\nEND OF s."],
  ["a component after a nested one", "DATA: BEGIN OF s,\n  BEGIN OF t,\n    a TYPE i,\n  END OF t,\n  r TYPE i VALUE 'abc',\nEND OF s."],
  ["STATICS in a form", "FORM f.\n  STATICS r TYPE i VALUE 'abc'.\nENDFORM."],
  ["DATA in a form", "FORM f.\n  DATA r TYPE i VALUE 'abc'.\nENDFORM."],
  ["a literal written with &", "DATA r TYPE i VALUE '30000' & '00000'."],
  ["a class attribute", "CLASS lcl DEFINITION.\n  PUBLIC SECTION.\n    DATA r TYPE i VALUE 'abc'.\nENDCLASS.\nCLASS lcl IMPLEMENTATION.\nENDCLASS."],
  ["a static attribute", "CLASS lcl DEFINITION.\n  PUBLIC SECTION.\n    CLASS-DATA r TYPE i VALUE 'abc'.\nENDCLASS.\nCLASS lcl IMPLEMENTATION.\nENDCLASS."],
  ["a static structure", "CLASS lcl DEFINITION.\n  PUBLIC SECTION.\n    CLASS-DATA: BEGIN OF s,\n      r TYPE i VALUE 'abc',\n    END OF s.\nENDCLASS.\nCLASS lcl IMPLEMENTATION.\nENDCLASS."],
  ["a class constant", "CLASS lcl DEFINITION.\n  PUBLIC SECTION.\n    CONSTANTS r TYPE i VALUE 'abc'.\nENDCLASS.\nCLASS lcl IMPLEMENTATION.\nENDCLASS."],
  ["an interface constant", "INTERFACE lif.\n  CONSTANTS r TYPE i VALUE 'abc'.\nENDINTERFACE."],
];
for (const [name, body] of refused) {
  test(`VALUE literal refused: ${name}`, () => {
    const findings = syntaxCheck("prog", `REPORT zprobe.\n${body}`, DTELS);
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], / cannot be converted to the type of r \[value_literal\]$/);
  });
}

test("VALUE literal refused in a method", () => {
  const findings = syntaxCheck("clas", classrun("DATA r TYPE i VALUE 'abc'."));
  assert.equal(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /: the VALUE 'abc' cannot be converted to the type of r \[value_literal\]$/);
});

const accepted: [string, string][] = [
  ["a move that does not convert", "DATA i TYPE i.\nDATA b TYPE zbyte.\ni = 'abc'.\ni = 3000000000.\nb = 300."],
  ["VALUE IS INITIAL", "DATA r TYPE i VALUE IS INITIAL."],
  ["a literal that is rounded", "DATA r TYPE i VALUE '2.5'."],
  ["a component whose literal fits", "DATA: BEGIN OF s,\n  a TYPE c VALUE 'x',\n  r TYPE i VALUE '7',\nEND OF s."],
  ["a parameter default, which is no VALUE", "PARAMETERS r TYPE i DEFAULT 'abc'."],
];
for (const [name, body] of accepted) {
  test(`VALUE literal accepted: ${name}`, () => {
    assert.deepEqual(syntaxCheck("prog", `REPORT zprobe.\n${body}`, DTELS), []);
  });
}
