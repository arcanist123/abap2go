import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "../src/build";
import { BuildError } from "../src/errors";

const MANIFEST = fs.readFileSync(path.join(__dirname, "..", "..", "examples", "hello", ".abapgit.xml"), "utf-8");
const PROG_XML = (name: string) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_PROG" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <PROGDIR><NAME>${name}</NAME><SUBC>1</SUBC><FIXPT>X</FIXPT><UCCHECK>X</UCCHECK></PROGDIR>
  </asx:values>
 </asx:abap>
</abapGit>
`;
const CLAS_XML = (name: string) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <VSEOCLASS><CLSNAME>${name}</CLSNAME><LANGU>E</LANGU><STATE>1</STATE><FIXPT>X</FIXPT><UNICODE>X</UNICODE></VSEOCLASS>
  </asx:values>
 </asx:abap>
</abapGit>
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "abap2go-test-"));
let counter = 0;

/** Builds the root from one source file and returns its stdout, or the refusal message, or the runtime error. */
function run(kind: "prog" | "clas", source: string): { stdout?: string; refused?: string; failed?: string } {
  const dir = path.join(tmp, String(counter++));
  const name = kind === "prog" ? "ZPROBE" : "ZCL_PROBE";
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".abapgit.xml"), MANIFEST);
  fs.writeFileSync(path.join(dir, "src", `${name.toLowerCase()}.${kind}.abap`), source);
  fs.writeFileSync(path.join(dir, "src", `${name.toLowerCase()}.${kind}.xml`), kind === "prog" ? PROG_XML(name) : CLAS_XML(name));
  let exe: string;
  try {
    exe = build({ inputs: [dir], root: name, out: path.join(dir, "out") });
  } catch (e) {
    if (e instanceof BuildError) {
      return { refused: e.message };
    }
    throw e;
  }
  try {
    return { stdout: execFileSync(exe, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    if (err.status === 1) {
      return { stdout: err.stdout, failed: err.stderr };
    }
    throw e;
  }
}

const classrun = (body: string) => `CLASS zcl_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_probe IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
${body}
  ENDMETHOD.
ENDCLASS.
`;

// Reports: output as open-abap-gui's list processor lays it out (open-steamgate is the reference for WRITE).
const reports: [string, string, string][] = [
  ["hello world", "REPORT zprobe.\nWRITE 'Hello, World!'.", "Hello, World!\n"],
  ["no standard page heading changes nothing without TOP-OF-PAGE", "REPORT zprobe NO STANDARD PAGE HEADING.\nWRITE 'a'.", "a\n"],
  ["gap of one blank, WRITE / starts a line", "REPORT zprobe.\nWRITE 'it''s'. WRITE `str`. WRITE / 'x'. WRITE 'y'.", "it's str\nx y\n"],
  ["WRITE / as the first output starts no empty line", "REPORT zprobe.\nWRITE / 'a'. WRITE / 'b'.", "a\nb\n"],
  ["explicit START-OF-SELECTION", "REPORT zprobe.\nSTART-OF-SELECTION.\n  WRITE 'a'.", "a\n"],
  ["no wrap at LINE-SIZE", "REPORT zprobe LINE-SIZE 10.\nWRITE 'Hello'. WRITE 'World'.", "Hello World\n"],
  ["no wrap at the default width", `REPORT zprobe.\nWRITE '${"x".repeat(100)}'. WRITE '${"y".repeat(100)}'.`, `${"x".repeat(100)} ${"y".repeat(100)}\n`],
  ["characters outside ASCII count one column each", "REPORT zprobe.\nWRITE 'Grüße'. WRITE 'x'.", "Grüße x\n"],
  ["empty program writes nothing", "REPORT zprobe.", ""],
];
for (const [name, source, stdout] of reports) {
  test(`report: ${name}`, () => {
    assert.deepEqual(run("prog", source), { stdout });
  });
}

const reportRefusals: [string, string, RegExp][] = [
  ["DATA of a reference", "REPORT zprobe.\nDATA x TYPE REF TO object.", /:2:1: x: type .* is not supported yet/],
  ["arithmetic", "REPORT zprobe.\nDATA x TYPE i.\nx = x + 1.", /:3:1: assignment of x \+ 1: only a literal or a variable/],
  ["WRITE of a variable", "REPORT zprobe.\nDATA x TYPE i.\nWRITE x.", /WRITE of x: only a literal/],
  ["WRITE addition", "REPORT zprobe.\nWRITE 'a' COLOR 1.", /no additions/],
  ["WRITE of a variable", "REPORT zprobe.\nCONSTANTS c TYPE string VALUE `a`.\nWRITE c.", /statement Constant is not supported yet/],
  ["text field literal ending in blanks", "REPORT zprobe.\nWRITE 'a '.", /ending in blanks/],
  ["empty text field literal", "REPORT zprobe.\nWRITE ''.", /ending in blanks/],
  ["other events", "REPORT zprobe.\nINITIALIZATION.\nSTART-OF-SELECTION.\nWRITE 'a'.", /statement Initialization is not supported yet/],
  ["TOP-OF-PAGE", "REPORT zprobe.\nTOP-OF-PAGE.\nWRITE 'h'.\nSTART-OF-SELECTION.\nWRITE 'a'.", /statement TopOfPage is not supported yet/],
  ["REPORT addition", "REPORT zprobe MESSAGE-ID zz.\nWRITE 'a'.", /REPORT addition MESSAGE-ID/],
  ["syntax error", "REPORT zprobe.\nWRITE foo.", /do not pass the syntax check[\s\S]*"foo" not found/],
];
for (const [name, source, refused] of reportRefusals) {
  test(`report refused: ${name}`, () => {
    const result = run("prog", source);
    assert.ok(result.refused !== undefined, `built, stdout ${JSON.stringify(result.stdout)}`);
    assert.match(result.refused, refused);
  });
}

// Classrun: one line per write, as open-steamgate's ZCL_OSD_CLASSRUN_OUT.
const classruns: [string, string, string][] = [
  ["hello world", "out->write( 'Hello, World!' ).", "Hello, World!\n"],
  ["data and name", "out->write( data = `v` name = 'n' ).", "n = v\n"],
  ["empty name is no name", "out->write( data = 'v' name = `` ).", "v\n"],
  ["c to string drops trailing blanks", "out->write( 'a  ' ). out->write( '' ). out->write( ` b ` ).", "a\n\n b \n"],
];
for (const [name, body, stdout] of classruns) {
  test(`classrun: ${name}`, () => {
    assert.deepEqual(run("clas", classrun(body)), { stdout });
  });
}

// Moves and out->write( variable ) follow the conversion rules (docs/spec/conversion.md); each expected output
// is a cell of runtime/go/abap/testdata/conversion.tsv.
const conversions: [string, string, string][] = [
  ["i to string has the sign at the end", "DATA i TYPE i VALUE -7. out->write( i ).", "7-\n"],
  ["a positive i to string ends in a blank", "DATA i TYPE i VALUE 42. out->write( i ).", "42 \n"],
  ["p to a short c", "DATA p TYPE p LENGTH 8 DECIMALS 2 VALUE '1.5'. DATA c TYPE c LENGTH 3. c = p. out->write( c ).", "*50\n"],
  ["text to i, sign at the end", "DATA s TYPE string VALUE ` 12- `. DATA i TYPE i. i = s. out->write( i ).", "12-\n"],
  ["d to i counts days on the Julian calendar before 1582", "DATA d TYPE d VALUE '19000101'. DATA i TYPE i. i = d. out->write( i ).", "693597 \n"],
  ["i to d", "DATA i TYPE i VALUE 577737. DATA d TYPE d. d = i. out->write( d ).", "15821015\n"],
  ["f to string", "DATA f TYPE f VALUE '0.1'. out->write( f ).", "1.0000000000000001E-01\n"],
  ["decfloat34 keeps its scale", "DATA d TYPE decfloat34 VALUE '1.00'. out->write( d ).", "1.00\n"],
  ["x from i", "DATA i TYPE i VALUE -7. DATA x TYPE x LENGTH 4. x = i. out->write( x ).", "FFFFFFF9\n"],
  ["utclong from text", "DATA u TYPE utclong. DATA s TYPE string VALUE `2024-02-29T12:34:56,5`. u = s. out->write( u ).", "2024-02-29 12:34:56.5000000\n"],
  ["n keeps only the digits of text", "DATA n TYPE n LENGTH 4. n = 'a1b2c3'. out->write( n ).", "0123\n"],
  ["same type is a copy", "DATA a TYPE c LENGTH 3 VALUE 'ab'. DATA b TYPE c LENGTH 3. b = a. out->write( data = b name = 'b' ).", "b = ab\n"],
];
for (const [name, body, stdout] of conversions) {
  test(`classrun conversion: ${name}`, () => {
    assert.deepEqual(run("clas", classrun(body)), { stdout });
  });
}

test("an uncaught conversion exception ends the program", () => {
  const result = run("clas", classrun("out->write( 'before' ). DATA i TYPE i. DATA s TYPE string VALUE `2147483648`. i = s. out->write( 'after' )."));
  assert.equal(result.stdout, "before\n");
  assert.match(result.failed ?? "", /CX_SY_CONVERSION_OVERFLOW/);
});

test("report: DATA and moves run before WRITE", () => {
  assert.deepEqual(run("prog", "REPORT zprobe.\nDATA s TYPE string.\nDATA i TYPE i VALUE 5.\ns = i.\nWRITE 'done'."), { stdout: "done\n" });
});

const classrunRefusals: [string, string, RegExp][] = [
  ["chained write", "out->write( 'a' )->write( 'b' ).", /only out->write/],
  ["other statement", "DATA x TYPE i. CLEAR x.", /statement Clear is not supported yet/],
  ["non-literal data", "out->write( sy-uname ).", /only a literal/],
];
for (const [name, body, refused] of classrunRefusals) {
  test(`classrun refused: ${name}`, () => {
    const result = run("clas", classrun(body));
    assert.ok(result.refused !== undefined, `built, stdout ${JSON.stringify(result.stdout)}`);
    assert.match(result.refused, refused);
  });
}

test("classrun refused: constructor", () => {
  const source = `CLASS zcl_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    METHODS constructor.
ENDCLASS.
CLASS zcl_probe IMPLEMENTATION.
  METHOD constructor.
  ENDMETHOD.
  METHOD if_oo_adt_classrun~main.
  ENDMETHOD.
ENDCLASS.
`;
  assert.match(run("clas", source).refused ?? "", /CONSTRUCTOR is not supported yet/);
});

test("class without IF_OO_ADT_CLASSRUN is not a root", () => {
  const source = `CLASS zcl_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
ENDCLASS.
CLASS zcl_probe IMPLEMENTATION.
ENDCLASS.
`;
  assert.match(run("clas", source).refused ?? "", /must implement IF_OO_ADT_CLASSRUN/);
});
