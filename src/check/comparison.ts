import * as abaplint from "@abaplint/core";
import { CheckInput, expressions, issueAt } from "./input";
import {
  builtInCall, isArithmetic, isCalculationOperand, isDataObject, parenthesized, unnamedArgument, withoutParentheses,
} from "./operand";
import { operandType } from "./types";

const { Expressions, BasicTypes } = abaplint;

type ExpressionNode = abaplint.Nodes.ExpressionNode;

/** The comparison operators for operands of any kind; CS, O and the like have rules of their own. */
const COMPARISON_OPERATORS = new Set(["=", "EQ", "<>", "NE", "><", "<", "LT", ">", "GT", "<=", "LE", "=<", ">=", "GE", "=>"]);

/**
 * The operands of a comparison and of BETWEEN: an arithmetic expression only with numeric operands or other
 * arithmetic expressions, and no two operands without a comparison type (docs/spec/comparison.md, "Syntax errors").
 * One finding per comparison.
 */
export function comparisonOperands(input: CheckInput): abaplint.Issue[] {
  const issues: abaplint.Issue[] = [];
  for (const node of expressions(input.file)) {
    if (!(node.get() instanceof Expressions.Compare)) {
      continue;
    }
    const sources = node.findDirectExpressions(Expressions.Source);
    const operator = node.findDirectExpression(Expressions.CompareOperator)?.concatTokens().toUpperCase();
    const between = node.findDirectTokenByText("BETWEEN") !== undefined && sources.length === 3;
    if (!between && (operator === undefined || sources.length !== 2)) {
      continue;
    }
    const types = sources.map(s => operandType(s, input));

    const calculation = calculationMessage(sources, types, input);
    if (calculation !== undefined) {
      issues.push(issueAt(input, node.getFirstToken(), calculation, "comparison_calculation"));
    } else if ((between || COMPARISON_OPERATORS.has(operator!))
        // each bound of BETWEEN is compared with the operand
        && types.slice(1).some(t => !hasComparisonType(types[0], t))) {
      issues.push(issueAt(input, node.getFirstToken(), "Incompatible types for comparison", "comparison_type"));
    }
  }
  return issues;
}

// The three operands of BETWEEN share one calculation, so an arithmetic expression among them applies to the others.
// A "+" in front makes an operand an arithmetic expression, "+ lv_c".
function calculationMessage(sources: readonly ExpressionNode[], types: readonly (abaplint.AbstractType | undefined)[],
    input: CheckInput): string | undefined {
  const arithmetic = sources.map(s => isArithmetic(s, input));
  if (!arithmetic.includes(true)) {
    return undefined;
  }
  for (let i = 0; i < sources.length; i++) {
    if (arithmetic[i]) {
      continue;
    } else if (types[i] instanceof BasicTypes.UTCLongType) {
      return "A time stamp of type utclong cannot be compared with an arithmetic expression";
    } else if (isNonNumeric(types[i])) {
      const operand = sources[i].concatTokens();
      return `Arithmetic expression cannot be compared with non-numeric operand "${operand}", use "+ ${operand}"`;
    }
  }
  return undefined;
}

function isNonNumeric(type: abaplint.AbstractType | undefined): boolean {
  return [BasicTypes.CharacterType, BasicTypes.StringType, BasicTypes.NumericType, BasicTypes.DateType,
    BasicTypes.TimeType, BasicTypes.HexType, BasicTypes.XStringType, BasicTypes.StructureType, BasicTypes.CLikeType,
    BasicTypes.CSequenceType, BasicTypes.CGenericType, BasicTypes.NGenericType, BasicTypes.XSequenceType,
    BasicTypes.XGenericType].some(kind => type instanceof kind);
}

/**
 * False for two elementary types which cannot be compared with each other: a date and a time, and a time stamp of
 * type utclong with anything but another one or a text of type c or string. True where a type is unknown.
 */
export function hasComparisonType(a: abaplint.AbstractType | undefined, b: abaplint.AbstractType | undefined): boolean {
  if ((a instanceof BasicTypes.DateType && b instanceof BasicTypes.TimeType)
      || (a instanceof BasicTypes.TimeType && b instanceof BasicTypes.DateType)) {
    return false;
  }
  const other = a instanceof BasicTypes.UTCLongType ? b : b instanceof BasicTypes.UTCLongType ? a : undefined;
  return !([BasicTypes.IntegerType, BasicTypes.Integer8Type, BasicTypes.PackedType, BasicTypes.FloatType,
    BasicTypes.FloatingPointType, BasicTypes.DecFloat16Type, BasicTypes.DecFloat34Type, BasicTypes.DecFloatType,
    BasicTypes.HexType, BasicTypes.XStringType, BasicTypes.DateType, BasicTypes.TimeType]
    .some(kind => other instanceof kind)
    || (other instanceof BasicTypes.NumericType && !(other instanceof BasicTypes.NGenericType)));
}

/**
 * Outside a calculation a data object as the argument of a numeric function cannot be in parentheses,
 * IF abs( ( a ) ) = 1., while abs( ( a ) ) = b + 1 is a calculation. The operands of a logical expression share the
 * calculation, so one of them being calculated is enough; in a WHERE condition each operand is on its own.
 */
export function argumentParentheses(input: CheckInput): abaplint.Issue[] {
  const issues: abaplint.Issue[] = [];
  for (const node of expressions(input.file)) {
    const sources = node.findDirectExpressions(Expressions.Source);
    if (node.get() instanceof Expressions.Compare) {
      issues.push(...operandParentheses(sources, input));
    } else if (node.get() instanceof Expressions.ComponentCompare) {
      issues.push(...sources.flatMap(s => operandParentheses([s], input)));
    }
  }
  return issues;
}

/** The findings of the rule above on operands that share a calculation; CASE applies it to its operand. */
export function operandParentheses(operands: readonly ExpressionNode[], input: CheckInput): abaplint.Issue[] {
  if (operands.some(o => isCalculationOperand(o, input))) {
    return [];
  }
  const issues: abaplint.Issue[] = [];
  for (const operand of operands) {
    const call = builtInCall(withoutParentheses(operand), input);
    if (call === undefined || !abaplint.BuiltIn.hasUnnamedArgument(call.name)) {
      continue;
    }
    const parameter = abaplint.BuiltIn.searchBuiltin(call.name.toUpperCase())?.getParameters().getImporting()[0];
    if (!(parameter?.getType() instanceof BasicTypes.NumericGenericType)) {
      continue;
    }
    const argument = unnamedArgument(call);
    const inner = argument === undefined ? undefined : parenthesized(argument);
    if (inner !== undefined && isDataObject(withoutParentheses(inner))) {
      issues.push(issueAt(input, argument!.getFirstToken(),
        `Parentheses around the argument of "${call.name}" are only allowed in a calculation`, "argument_parentheses"));
    }
  }
  return issues;
}
