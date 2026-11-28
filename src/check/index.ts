// Layer 2 of the syntax check: invalid ABAP that abaplint (layer 1, src/validation.ts) accepts. See "The syntax
// check in two layers" in docs/aot_for_abap.md and "Two layers" in docs/abaplint_roadmap.md.
//
// A check here goes once an abaplint release reports its case in every form; its tests then expect abaplint's
// finding.

import * as abaplint from "@abaplint/core";
import { continueOutsideLoop } from "./loops";
import { numberLiteralLength } from "./literals";
import { substringBounds } from "./substring";
import { Check } from "./input";

const CHECKS: readonly Check[] = [continueOutsideLoop, numberLiteralLength, substringBounds];

/**
 * The findings of layer 2 in every ABAP object of the registry that passed layer 1. An object with a finding of
 * layer 1 is left out: abaplint stops typing it at its first error, so its tree and types are not to be relied on.
 */
export function check(registry: abaplint.IRegistry, layer1: readonly abaplint.Issue[]): abaplint.Issue[] {
  const failed = new Set<abaplint.IObject>();
  for (const issue of layer1) {
    const file = registry.getFileByName(issue.getFilename());
    const obj = file === undefined ? undefined : registry.findObjectForFile(file);
    if (obj !== undefined) {
      failed.add(obj);
    }
  }
  const issues: abaplint.Issue[] = [];
  for (const obj of registry.getObjects()) {
    if (!(obj instanceof abaplint.ABAPObject) || failed.has(obj)) {
      continue;
    }
    // the same syntax run as src/validation.ts and the lowering: abaplint caches its result on the object
    const spaghetti = new abaplint.SyntaxLogic(registry, obj).run().spaghetti;
    for (const file of obj.getABAPFiles()) {
      for (const run of CHECKS) {
        issues.push(...run({ obj, file, spaghetti }));
      }
    }
  }
  return issues;
}
