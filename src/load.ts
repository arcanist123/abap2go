import * as fs from "node:fs";
import * as path from "node:path";
import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { check } from "./check";
import { isScopeFinding, scope } from "./scope";
import { config, validate } from "./validation";

/** The built-in library package, part of every world. */
export const LIB_PACKAGE = path.join(__dirname, "..", "..", "lib");

/**
 * Reads abapGit packages (folders with .abapgit.xml) into one abaplint registry, the world of the build, and runs
 * every check that comes before the lowering: both layers of the syntax check (abaplint with the rules of
 * src/validation.ts, then src/check/) and the scope of abap2go (src/scope/). Every finding of all three is reported
 * before any lowering, the syntax errors first. The built-in library package is always added.
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

  // Layer 1 the same way abaplint/transpiler checks its input (src/validation.ts), less the rules that report
  // scope rather than syntax; layer 2 on what passes it; then the scope.
  const registry = new abaplint.Registry(new abaplint.Config(JSON.stringify(config))).addFiles(files).parse();
  const abaplintIssues = validate(registry);
  const layer1 = abaplintIssues.filter(i => !isScopeFinding(i));
  const syntax = [...layer1, ...check(registry, layer1)];
  const unsupported = scope(registry, abaplintIssues.filter(isScopeFinding));
  const parts: string[] = [];
  if (syntax.length > 0) {
    parts.push(`the packages do not pass the syntax check:\n${format(syntax)}`);
  }
  if (unsupported.length > 0) {
    parts.push(`the packages use ABAP that abap2go does not support:\n${format(unsupported)}`);
  }
  if (parts.length > 0) {
    throw new BuildError(parts.join("\n"));
  }
  return registry;
}

function format(issues: readonly abaplint.Issue[]): string {
  return issues.map(i => `${i.getFilename()}:${i.getStart().getRow()}:${i.getStart().getCol()}: ${i.getMessage()} [${i.getKey()}]`).join("\n");
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
