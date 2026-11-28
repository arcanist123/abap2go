// The scope of abap2go: valid ABAP that it does not compile by design, as opposed to invalid ABAP (layers 1 and 2,
// src/validation.ts and src/check/) and valid ABAP not compiled yet (the lowering). See "Four kinds of refusal" in
// docs/aot_for_abap.md.
//
// A rule here has a reason that holds whatever the lowering learns, and goes only when that reason does: an
// ambiguous statement, for example, once the compiler resolves it (docs/abaplint_ambiguous_parsing.md).

import * as abaplint from "@abaplint/core";
import { programAttributes } from "./attributes";

/**
 * abaplint rules whose findings are out of scope, not syntax errors. Their findings are taken out of layer 1, so
 * that they do not keep layer 2 from checking the object: these rules do not stop abaplint's typing.
 */
export const SCOPE_RULES: ReadonlySet<string> = new Set([
  // a statement with more than one reading is refused, even where the name would decide it
  "ambiguous_statement",
]);

/** Whether a finding of abaplint belongs to the scope pass rather than to layer 1. */
export function isScopeFinding(issue: abaplint.Issue): boolean {
  return SCOPE_RULES.has(issue.getKey());
}

/** The out-of-scope findings of the registry: those of the abaplint rules above, then abap2go's own. */
export function scope(registry: abaplint.IRegistry, findings: readonly abaplint.Issue[]): abaplint.Issue[] {
  return [...findings, ...programAttributes(registry)];
}
