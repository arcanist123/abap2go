#!/usr/bin/env node
import { BuildError } from "./errors";
import { build } from "./build";

const USAGE = "usage: abap2go --input <abapGit package folder> [--input <folder>]... --root <program or class> --out <output folder>";

function parseArgs(argv: string[]): { inputs: string[]; root: string; out: string } {
  const inputs: string[] = [];
  let root = "";
  let out = "";
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    if (value === undefined) {
      usage();
    }
    switch (argv[i]) {
      case "--input": inputs.push(value); break;
      case "--root": root = value; break;
      case "--out": out = value; break;
      default: usage();
    }
  }
  if (inputs.length === 0 || !root || !out) {
    usage();
  }
  return { inputs, root, out };
}

function usage(): never {
  console.error(USAGE);
  process.exit(2);
}

try {
  console.log(`built ${build(parseArgs(process.argv.slice(2)))}`);
} catch (e) {
  if (e instanceof BuildError) {
    console.error(`build refused: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
