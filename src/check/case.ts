import * as abaplint from "@abaplint/core";
import { hasComparisonType, operandParentheses } from "./comparison";
import { CheckInput, issueAt } from "./input";
import {
  builtInCall, isArithmetic, isBitExpression, isCalculation, isDataObject, isNumericFunction, parenthesized,
  unnamedArgument, word,
} from "./operand";
import { operandType } from "./types";

const { Expressions, Statements, Structures, Nodes } = abaplint;

type ExpressionNode = abaplint.Nodes.ExpressionNode;
type StatementNode = abaplint.Nodes.StatementNode;

/**
 * The operands of CASE and WHEN (docs/spec/comparison.md, "CASE"). After CASE, parentheses are possible only around a
 * calculation. After WHEN nothing is calculated: no expression, no parentheses, and of the built-in functions only a
 * numeric one of a data object. Each value after WHEN needs a comparison type with the operand of its CASE.
 */
export function caseOperands(input: CheckInput): abaplint.Issue[] {
  const issues: abaplint.Issue[] = [];
  // operand: the type of the operand of the innermost CASE, undefined for the result of an arithmetic expression
  const walk = (node: abaplint.INode, operand: abaplint.AbstractType | undefined): void => {
    if (node instanceof Nodes.StatementNode) {
      if (node.get() instanceof Statements.When) {
        issues.push(...whenValues(node, operand, input));
      }
      return;
    }
    if (node instanceof Nodes.StructureNode && node.get() instanceof Structures.Case) {
      const source = node.findDirectStatement(Statements.Case)?.findDirectExpression(Expressions.Source);
      operand = undefined;
      if (source !== undefined) {
        issues.push(...caseSource(source, input));
        operand = isArithmetic(source, input) ? undefined : operandType(source, input);
      }
    }
    for (const child of node.getChildren()) {
      walk(child, operand);
    }
  };
  const structure = input.file.getStructure();
  if (structure !== undefined) {
    walk(structure, undefined);
  }
  return issues;
}

function caseSource(source: ExpressionNode, input: CheckInput): abaplint.Issue[] {
  const inner = parenthesized(source);
  if (inner !== undefined && !isCalculation(inner, input)) {
    return [issueAt(input, source.getFirstToken(),
      "Parentheses after CASE only around a calculation, not around a single operand", "case_operand")];
  }
  return operandParentheses([source], input);
}

function whenValues(statement: StatementNode, operand: abaplint.AbstractType | undefined,
    input: CheckInput): abaplint.Issue[] {
  // WHEN a OR b
  const values = [...statement.findDirectExpressions(Expressions.Source),
    ...statement.findDirectExpressions(Expressions.Or).flatMap(o => o.findDirectExpressions(Expressions.Source))];
  const issues: abaplint.Issue[] = [];
  for (const value of values) {
    const message = whenMessage(value, input);
    if (message !== undefined) {
      issues.push(issueAt(input, value.getFirstToken(), message, "when_operand"));
    } else if (!hasComparisonType(operand, operandType(value, input))) {
      issues.push(issueAt(input, value.getFirstToken(), "Incompatible types for comparison", "comparison_type"));
    }
  }
  return issues;
}

/** Why the source cannot be a value after WHEN. Literals joined with & are one literal, 'a' & 'b'. */
function whenMessage(source: ExpressionNode, input: CheckInput): string | undefined {
  const children = source.getChildren();
  const keyword = word(children[0]);
  if (isArithmetic(source, input)) {
    return "Arithmetic expression not allowed after WHEN";
  } else if (keyword === "(") {
    return "Parentheses not allowed after WHEN";
  } else if (children.some(c => word(c) === "&&") || children[0]?.get() instanceof Expressions.StringTemplate) {
    return "String expression not allowed after WHEN";
  } else if (isBitExpression(source)) {
    return "Bit expression not allowed after WHEN";
  } else if (children.some(c => c instanceof Nodes.ExpressionNode
      && (c.get() instanceof Expressions.FieldChain || c.get() instanceof Expressions.MethodCallChain)
      && c.findDirectExpression(Expressions.TableExpression) !== undefined)) {
    return "Table expression not allowed after WHEN";
  } else if (keyword !== undefined && /^(BOOLC|BOOLX|BIT|XSDBOOL)$/.test(keyword)) {
    // these have forms of their own in the syntax tree; the lexer splits BIT-SET into three tokens
    const name = keyword === "BIT" ? "bit-set" : children[0].concatTokens();
    return `Built-in function "${name}" not allowed after WHEN, only a numeric function`;
  }

  const call = builtInCall(source, input);
  if (call === undefined) {
    return undefined;
  } else if (!isNumericFunction(call)) {
    return `Built-in function "${call.name}" not allowed after WHEN, only a numeric function`;
  }
  const argument = unnamedArgument(call);
  if (abaplint.BuiltIn.hasUnnamedArgument(call.name) && argument !== undefined && isDataObject(argument)) {
    return undefined;
  }
  return `Built-in function "${call.name}" not allowed after WHEN, only a function of a data object`;
}
