import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { loadPackages } from "./load";
import { lowerRoot } from "./lower";
import { emitGo } from "./emit_go";

/** The runtime Go module (module path abap2go). */
export const RUNTIME_MODULE = path.join(__dirname, "..", "..", "runtime", "go");

export interface BuildOptions {
  /** abapGit package folders, the world besides the built-in library. */
  inputs: string[];
  /** The root: an executable program or a class implementing IF_OO_ADT_CLASSRUN. */
  root: string;
  /** Output folder, replaced on every build. */
  out: string;
}

/**
 * Compiles one root into one executable. As in open-steamgate's osabap, the generated code is package main under
 * cmd/<root> inside a copy of the runtime module, built with -trimpath and a stripped binary.
 * Returns the path of the executable. Throws BuildError when the root is refused.
 */
export function build(options: BuildOptions): string {
  const registry = loadPackages(options.inputs);
  const root = lowerRoot(registry, options.root);

  const name = root.name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  fs.rmSync(options.out, { recursive: true, force: true });
  fs.cpSync(RUNTIME_MODULE, options.out, { recursive: true, filter: src => !src.endsWith("_test.go") });
  const cmd = path.join(options.out, "cmd", name);
  fs.mkdirSync(cmd, { recursive: true });
  fs.writeFileSync(path.join(cmd, "main.go"), emitGo(root));

  const exe = name + (process.platform === "win32" ? ".exe" : "");
  execFileSync("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", exe, "./cmd/" + name], { cwd: options.out, stdio: "inherit" });
  return path.join(options.out, exe);
}
