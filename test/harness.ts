import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "../src/build";
import { BuildError } from "../src/errors";
import { loadPackages } from "../src/load";

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

/** Writes a package of one source file and more files, by file name, and returns its folder and root name. */
function writePackage(kind: "prog" | "clas", source: string, files: Record<string, string>): { dir: string; name: string } {
  const dir = path.join(tmp, String(counter++));
  const name = kind === "prog" ? "ZPROBE" : "ZCL_PROBE";
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".abapgit.xml"), MANIFEST);
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, "src", file), content);
  }
  fs.writeFileSync(path.join(dir, "src", `${name.toLowerCase()}.${kind}.abap`), source);
  fs.writeFileSync(path.join(dir, "src", `${name.toLowerCase()}.${kind}.xml`), kind === "prog" ? PROG_XML(name) : CLAS_XML(name));
  return { dir, name };
}

/**
 * Runs both layers of the syntax check over a package of one source file, without lowering or Go, and returns the
 * findings as `row:col: message [key]`, empty if it passes.
 */
export function syntaxCheck(kind: "prog" | "clas", source: string, files: Record<string, string> = {}): string[] {
  const { dir } = writePackage(kind, source, files);
  try {
    loadPackages([dir]);
    return [];
  } catch (e) {
    if (!(e instanceof BuildError)) {
      throw e;
    }
    return e.message.split("\n").slice(1).map(line => line.replace(/^.*?:(?=\d+:\d+: )/, ""));
  }
}

/**
 * Builds the root from one source file and returns its stdout, or the refusal message, or the runtime error.
 * With a user setup, the executable runs with --user-setup pointing at it; a run it rejects (exit code 2) gives
 * rejected with its message. files are more files of the package, by file name (data elements, domains).
 */
export function run(kind: "prog" | "clas", source: string, userSetup?: object, files: Record<string, string> = {}): { stdout?: string; refused?: string; failed?: string; rejected?: string } {
  const { dir, name } = writePackage(kind, source, files);
  let exe: string;
  try {
    exe = build({ inputs: [dir], root: name, out: path.join(dir, "out") });
  } catch (e) {
    if (e instanceof BuildError) {
      return { refused: e.message };
    }
    throw e;
  }
  const args: string[] = [];
  if (userSetup !== undefined) {
    const file = path.join(dir, "users.json");
    fs.writeFileSync(file, JSON.stringify(userSetup));
    args.push("--user-setup", file);
  }
  try {
    return { stdout: execFileSync(exe, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    if (err.status === 1) {
      return { stdout: err.stdout, failed: err.stderr };
    }
    if (err.status === 2) {
      return { stdout: err.stdout, rejected: err.stderr };
    }
    throw e;
  }
}

export const classrun = (body: string) => `CLASS zcl_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_probe IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
${body}
  ENDMETHOD.
ENDCLASS.
`;
/** An abapGit object file with the given values. */
export const abapgit = (serializer: string, values: string) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="${serializer}" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
${values}
  </asx:values>
 </asx:abap>
</abapGit>
`;
export const dtel = (name: string, fields: string) => ({
  [`${name.toLowerCase()}.dtel.xml`]: abapgit("LCL_OBJECT_DTEL", `   <DD04V><ROLLNAME>${name}</ROLLNAME><DDLANGUAGE>E</DDLANGUAGE>${fields}<DDTEXT>t</DDTEXT></DD04V>`),
});
export const doma = (name: string, fields: string) => ({
  [`${name.toLowerCase()}.doma.xml`]: abapgit("LCL_OBJECT_DOMA", `   <DD01V><DOMNAME>${name}</DOMNAME><DDLANGUAGE>E</DDLANGUAGE>${fields}<DDTEXT>t</DDTEXT></DD01V>`),
});
