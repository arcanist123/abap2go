// The program attributes abap2go does not support: a program without the Unicode flag, or without fixed-point
// arithmetic. abaplint reads neither and assumes both are set (docs/abaplint_ambiguous_parsing.md, "Unicode flag"
// and "Fixed-point arithmetic").
//
// The attributes are read from each object's abapGit XML, which leaves out a field that is not set:
// - a program: UCCHECK and FIXPT of its PROGDIR
// - a function group: the same of the PROGDIR of its main program, a file of its own
// - a class: UNICODE and FIXPT of its VSEOCLASS
// - an interface: UNICODE of its VSEOINTERF, which has no fixed-point flag
// An include program takes the attributes of the program that includes it, so its own are not read. An object without
// the XML file that holds its flags is taken to have both set, as open-abap-core leaves the file out for most classes.
// An XML file without the element has no flag set.

import * as abaplint from "@abaplint/core";

interface Attributes {
  /** The element of the XML that holds the flags. */
  readonly element: string;
  readonly unicode: string;
  /** Whether the element has the fixed-point flag, FIXPT. */
  readonly fixedPoint: boolean;
}

const PROGRAM: Attributes = { element: "PROGDIR", unicode: "UCCHECK", fixedPoint: true };

const ATTRIBUTES: ReadonlyMap<string, Attributes> = new Map([
  ["PROG", PROGRAM],
  ["FUGR", PROGRAM],
  ["CLAS", { element: "VSEOCLASS", unicode: "UNICODE", fixedPoint: true }],
  ["INTF", { element: "VSEOINTERF", unicode: "UNICODE", fixedPoint: false }],
]);

/** The objects of the registry whose program attributes abap2go does not support, one finding per attribute. */
export function programAttributes(registry: abaplint.IRegistry): abaplint.Issue[] {
  const issues: abaplint.Issue[] = [];
  for (const obj of registry.getObjects()) {
    const attributes = ATTRIBUTES.get(obj.getType());
    if (attributes === undefined) {
      continue;
    }
    const elements = xmlElements(obj, attributes.element);
    // of the PROGDIRs of a function group, one per file, only that of its main program is not an include's
    const found = elements.find(e => value(e.content, "SUBC") !== "I");
    const file = found?.file ?? obj.getXMLFile();
    // nothing to check: no XML file, an include program, or a function group without the file of its main program
    if (file === undefined || (found === undefined && (obj.getType() === "FUGR" || elements.length > 0))) {
      continue;
    }
    const content = found?.content ?? "";
    const refuse = (message: string, key: string) => issues.push(abaplint.Issue.atRow(
      file, 1, `${obj.getType()} ${obj.getName()}: ${message}`, key, abaplint.Severity.Error));
    // the Unicode flag holds the ABAP language version, and every version is a Unicode one
    if (value(content, attributes.unicode) === undefined) {
      refuse(`the Unicode flag ${attributes.unicode} is not set, abap2go compiles Unicode programs only`, "unicode_flag");
    }
    if (attributes.fixedPoint && value(content, "FIXPT") !== "X") {
      refuse("fixed-point arithmetic (FIXPT) is not set, abap2go compiles programs with it only", "fixed_point_arithmetic");
    }
  }
  return issues;
}

/** The elements of that name in the XML files of the object, each with its file. */
function xmlElements(obj: abaplint.IObject, element: string): { file: abaplint.IFile; content: string }[] {
  const pattern = new RegExp(`<${element}>([\\s\\S]*?)</${element}>`);
  return obj.getFiles()
    .filter(file => file.getFilename().toLowerCase().endsWith(".xml"))
    .flatMap(file => {
      const content = pattern.exec(file.getRaw())?.[1];
      return content === undefined ? [] : [{ file, content }];
    });
}

/** The value of a field of an element, or undefined if it is not set. */
function value(content: string, field: string): string | undefined {
  return new RegExp(`<${field}>([^<]*)</${field}>`).exec(content)?.[1].trim() || undefined;
}
