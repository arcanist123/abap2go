import { test } from "node:test";
import * as assert from "node:assert/strict";
import { abapgit, classrun, run, syntaxCheck } from "../harness";

// A program without the Unicode flag or without fixed-point arithmetic is refused as out of scope
// (docs/abaplint_ambiguous_parsing.md, "Program attributes").

const report = "REPORT zprobe.";
const progdir = (name: string, fields: string, subc = "1") =>
  abapgit("LCL_OBJECT_PROG", `   <PROGDIR><NAME>${name}</NAME><SUBC>${subc}</SUBC>${fields}</PROGDIR>`);
const vseoclass = (fields: string) => abapgit("LCL_OBJECT_CLAS",
  `   <VSEOCLASS><CLSNAME>ZCL_PROBE</CLSNAME><LANGU>E</LANGU><STATE>1</STATE>${fields}</VSEOCLASS>`);
const vseointerf = (fields: string) => abapgit("LCL_OBJECT_INTF",
  `   <VSEOINTERF><CLSNAME>ZIF_OTHER</CLSNAME><LANGU>E</LANGU><STATE>1</STATE>${fields}</VSEOINTERF>`);
const intf = (fields: string) => ({
  "zif_other.intf.abap": "INTERFACE zif_other PUBLIC.\nENDINTERFACE.",
  "zif_other.intf.xml": vseointerf(fields),
});
/** A function group without function modules: its main program, with the given flags, and its TOP include. */
const fugr = (mainFields: string) => ({
  "zfg.fugr.xml": abapgit("LCL_OBJECT_FUGR", `   <AREAT>t</AREAT>
   <INCLUDES><SOBJ_NAME>LZFGTOP</SOBJ_NAME><SOBJ_NAME>SAPLZFG</SOBJ_NAME></INCLUDES>`),
  "zfg.fugr.lzfgtop.abap": "FUNCTION-POOL zfg.",
  "zfg.fugr.lzfgtop.xml": progdir("LZFGTOP", "", "I"),
  "zfg.fugr.saplzfg.abap": "INCLUDE lzfgtop.",
  "zfg.fugr.saplzfg.xml": progdir("SAPLZFG", mainFields, "F"),
});

const both = "<FIXPT>X</FIXPT><UCCHECK>X</UCCHECK>";

const refused: [string, "prog" | "clas", Record<string, string>, string[]][] = [
  ["report without UCCHECK", "prog", { "zprobe.prog.xml": progdir("ZPROBE", "<FIXPT>X</FIXPT>") }, ["unicode_flag"]],
  ["report without FIXPT", "prog", { "zprobe.prog.xml": progdir("ZPROBE", "<UCCHECK>X</UCCHECK>") },
    ["fixed_point_arithmetic"]],
  ["report without both", "prog", { "zprobe.prog.xml": progdir("ZPROBE", "") },
    ["unicode_flag", "fixed_point_arithmetic"]],
  ["report with empty flags", "prog", { "zprobe.prog.xml": progdir("ZPROBE", "<FIXPT/><UCCHECK></UCCHECK>") },
    ["unicode_flag", "fixed_point_arithmetic"]],
  ["class without UNICODE", "clas", { "zcl_probe.clas.xml": vseoclass("<FIXPT>X</FIXPT>") }, ["unicode_flag"]],
  ["class without FIXPT", "clas", { "zcl_probe.clas.xml": vseoclass("<UNICODE>X</UNICODE>") },
    ["fixed_point_arithmetic"]],
  ["interface without UNICODE", "prog", intf(""), ["unicode_flag"]],
  ["XML file without PROGDIR", "prog", { "zprobe.prog.xml": abapgit("LCL_OBJECT_PROG", "") },
    ["unicode_flag", "fixed_point_arithmetic"]],
  ["function group without both", "prog", fugr(""), ["unicode_flag", "fixed_point_arithmetic"]],
];
for (const [name, kind, files, keys] of refused) {
  test(`program attributes refused: ${name}`, () => {
    const findings = syntaxCheck(kind, kind === "prog" ? report : classrun(""), files);
    assert.deepEqual(findings.map(f => /\[(\w+)\]$/.exec(f)?.[1]), keys, findings.join("\n"));
  });
}

const accepted: [string, Record<string, string>][] = [
  // the language version of ABAP for Cloud Development, in the field of the Unicode flag
  ["another language version than X", { "zprobe.prog.xml": progdir("ZPROBE", "<FIXPT>X</FIXPT><UCCHECK>5</UCCHECK>") }],
  ["include program without flags", {
    "zinclude.prog.abap": "DATA gv TYPE i.",
    "zinclude.prog.xml": progdir("ZINCLUDE", "", "I"),
  }],
  ["interface, which has no FIXPT", intf("<UNICODE>X</UNICODE>")],
  ["function group, its include without flags", fugr(both)],
  // without the XML file that holds the flags, both are taken as set
  ["program without an XML file", { "zother.prog.abap": "REPORT zother." }],
  ["class without an XML file", {
    "zcl_other.clas.abap": "CLASS zcl_other DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_other IMPLEMENTATION.\nENDCLASS.",
  }],
  ["interface without an XML file", { "zif_other.intf.abap": "INTERFACE zif_other PUBLIC.\nENDINTERFACE." }],
  ["function group without the XML file of its main program",
    Object.fromEntries(Object.entries(fugr("")).filter(([file]) => file !== "zfg.fugr.saplzfg.xml"))],
];
for (const [name, files] of accepted) {
  test(`program attributes accepted: ${name}`, () => {
    assert.deepEqual(syntaxCheck("prog", report, files), []);
  });
}

test("program attributes: reported as not supported, naming the object, and layer 2 still checks it", () => {
  const { refused } = run("prog", report + "\nCONTINUE.", undefined, { "zprobe.prog.xml": progdir("ZPROBE", "") });
  assert.ok(refused !== undefined);
  assert.match(refused, /^the packages do not pass the syntax check:\n.*\[continue_outside_loop\]\n/);
  assert.match(refused, /\nthe packages use ABAP that abap2go does not support:\n.*zprobe\.prog\.xml:1:1: PROG ZPROBE: /);
});
