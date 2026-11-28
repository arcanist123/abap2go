import * as abaplint from "@abaplint/core";
import { CheckInput, expressions, issueAt } from "./input";

/** A number literal has at most 31 digits; leading zeros count, the sign does not. */
export function numberLiteralLength(input: CheckInput): abaplint.Issue[] {
  const issues: abaplint.Issue[] = [];
  for (const node of expressions(input.file)) {
    if (!(node.get() instanceof abaplint.Expressions.Integer)) {
      continue;
    }
    const digits = node.getLastToken();
    if (digits.getStr().length > 31) {
      issues.push(issueAt(input, digits, `the number literal ${digits.getStr()} has more than 31 digits`, "number_literal_length"));
    }
  }
  return issues;
}
