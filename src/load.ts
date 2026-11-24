import * as fs from "node:fs";
import * as path from "node:path";
import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { config, validate } from "./validation";

/** The built-in library package, part of every world. */
export const LIB_PACKAGE = path.join(__dirname, "..", "..", "lib");

/**
 * Reads abapGit packages (folders with .abapgit.xml) into one abaplint registry, the world of the build, and runs
 * the checks of src/validation.ts over it. The built-in library package is always added.
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

  // Checked the same way abaplint/transpiler checks its input (src/validation.ts).
  const registry = new abaplint.Registry(new abaplint.Config(JSON.stringify(config))).addFiles(files).parse();
  const issues = validate(registry);
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
