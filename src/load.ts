import * as fs from "node:fs";
import * as path from "node:path";
import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";

/** The ABAP release the input activates on. */
export const ABAP_VERSION = abaplint.Version.v758;

/** The built-in library package, part of every world. */
export const LIB_PACKAGE = path.join(__dirname, "..", "..", "lib");

/**
 * Reads abapGit packages (folders with .abapgit.xml) into one abaplint registry, the world of the build, and runs
 * the syntax check over it. The built-in library package is always added.
 */
export function loadPackages(inputs: string[]): abaplint.IRegistry {
  const files: abaplint.MemoryFile[] = [];
  for (const input of [LIB_PACKAGE, ...inputs]) {
    const manifest = path.join(input, ".abapgit.xml");
    if (!fs.existsSync(manifest)) {
      throw new BuildError(`${input}: not an abapGit package, .abapgit.xml is missing`);
    }
    const startingFolder = /<STARTING_FOLDER>([^<]*)<\/STARTING_FOLDER>/.exec(fs.readFileSync(manifest, "utf-8"))?.[1] ?? "/";
    for (const file of walk(path.join(input, startingFolder))) {
      files.push(new abaplint.MemoryFile(file, fs.readFileSync(file, "utf-8")));
    }
  }

  // Only the parser and check_syntax: lint rules are out of scope, the input is code that activates on SAP.
  const config = new abaplint.Config(JSON.stringify({
    global: { files: "/**/*.*" },
    syntax: { version: ABAP_VERSION, errorNamespace: "." },
    rules: { parser_error: true, check_syntax: true },
  }));
  const registry = new abaplint.Registry(config).addFiles(files).parse();

  const issues = registry.findIssues().filter(i => i.getSeverity() === abaplint.Severity.Error);
  if (issues.length > 0) {
    const lines = issues.map(i => `${i.getFilename()}:${i.getStart().getRow()}:${i.getStart().getCol()}: ${i.getMessage()} [${i.getKey()}]`);
    throw new BuildError(`the packages do not pass the syntax check:\n${lines.join("\n")}`);
  }
  return registry;
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}
