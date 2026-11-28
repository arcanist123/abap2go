import * as abaplint from "@abaplint/core";
import { InternalError, lowerAll, lowerEach, notCompiled } from "./errors";
import { IRAssert, IRComparand, IRCompareOp, IRCondition, IRExpr, IRFunction, IRSource, IRType } from "./ir";
import { isArithmetic, isDataObjectFunction, lowerArithmetic } from "./lower_arith";
import { lowerSource, Variables, Where } from "./lower_common";

const { Expressions } = abaplint;

const OPERATORS: Record<string, IRCompareOp> = {
  "=": "=", "EQ": "=",
  "<>": "<>", "NE": "<>", "><": "<>",
  "<": "<", "LT": "<",
  ">": ">", "GT": ">",
  "<=": "<=", "LE": "<=", "=<": "<=",
  ">=": ">=", "GE": ">=", "=>": ">=",
};

/** ASSERT condition. without ID, SUBKEY, FIELDS or CONDITION. */
export function lowerAssert(statement: abaplint.Nodes.StatementNode, variables: Variables, where: Where): IRAssert {
  const children = statement.getChildren();
  const cond = statement.findDirectExpression(Expressions.Cond);
  if (cond === undefined || children.length !== 3 || children[1] !== cond) {
    throw notCompiled(`${statement.concatTokens()}: only ASSERT <condition>. is compiled yet, no additions`, where);
  }
  return { kind: "assert", condition: lowerCondition(cond, variables, where) };
}

type Joiner = "and" | "or" | "equiv";

/**
 * A Cond: relational expressions joined by AND, OR and EQUIV, each perhaps with NOT, and parenthesized conditions.
 * abaplint gives them as one flat list; they bind NOT first, then AND, OR, EQUIV, each from left to right
 * (docs/spec/comparison.md, "Logical expressions").
 */
export function lowerCondition(cond: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRCondition {
  const parts: abaplint.Nodes.ExpressionNode[] = [];
  const joiners: Joiner[] = [];
  for (const child of cond.getChildren()) {
    if (child instanceof abaplint.Nodes.ExpressionNode
        && (child.get() instanceof Expressions.Compare || child.get() instanceof Expressions.CondSub)) {
      parts.push(child);
    } else {
      const word = child.concatTokens().toUpperCase();
      if (word !== "AND" && word !== "OR" && word !== "EQUIV") {
        throw new InternalError(`${cond.concatTokens()}: unexpected ${child.concatTokens()}`, where);
      }
      joiners.push(word.toLowerCase() as Joiner);
    }
  }
  if (parts.length !== joiners.length + 1) {
    throw new InternalError(`${cond.concatTokens()}: malformed logical expression`, where);
  }
  const operands = lowerEach(parts, part => part.get() instanceof Expressions.Compare
    ? lowerCompare(part, variables, where) : lowerCondSub(part, variables, where));
  // one level of priority at a time: the operands joined by it are folded from the left
  let items = operands;
  let ops = joiners;
  for (const level of ["and", "or", "equiv"] as Joiner[]) {
    const nextItems: IRCondition[] = [items[0]];
    const nextOps: Joiner[] = [];
    ops.forEach((op, k) => {
      if (op === level) {
        nextItems[nextItems.length - 1] = { kind: op, left: nextItems[nextItems.length - 1], right: items[k + 1] };
      } else {
        nextOps.push(op);
        nextItems.push(items[k + 1]);
      }
    });
    items = nextItems;
    ops = nextOps;
  }
  return items[0];
}

/** The number of NOT in front of a relational expression or a parenthesized condition: NOT NOT a = 1 gives 2. */
function leadingNots(node: abaplint.Nodes.ExpressionNode): number {
  const children = node.getChildren();
  let count = 0;
  while (count < children.length && children[count] instanceof abaplint.Nodes.TokenNode
      && children[count].concatTokens().toUpperCase() === "NOT") {
    count++;
  }
  return count;
}

/** NOT around a condition an odd number of times; an even number of NOT cancels out. */
function negate(condition: IRCondition, nots: number): IRCondition {
  return nots % 2 === 1 ? { kind: "not", operand: condition } : condition;
}

/** {NOT} ( Cond ). */
function lowerCondSub(sub: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRCondition {
  const inner = sub.findDirectExpression(Expressions.Cond);
  if (inner === undefined) {
    throw new InternalError(`${sub.concatTokens()}: malformed parenthesized condition`, where);
  }
  return negate(lowerCondition(inner, variables, where), leadingNots(sub));
}

/**
 * A relational expression, perhaps with any number of NOT before it: a comparison with = <> < > <= >= or [NOT]
 * BETWEEN. The other predicates (IS, IN, CO, CS, ...) are not compiled yet.
 */
function lowerCompare(compare: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRCondition {
  const text = compare.concatTokens();
  const nots = leadingNots(compare);
  const children = compare.getChildren().slice(nots);
  const words = children.map(c => c instanceof abaplint.Nodes.ExpressionNode ? undefined : c.concatTokens().toUpperCase());
  const sources = children.filter((c): c is abaplint.Nodes.ExpressionNode =>
    c instanceof abaplint.Nodes.ExpressionNode && c.get() instanceof Expressions.Source);
  const operator = children[1];

  let condition: IRCondition;
  if (children.length === 3 && sources.length === 2 && operator instanceof abaplint.Nodes.ExpressionNode
      && operator.get() instanceof Expressions.CompareOperator) {
    const op = OPERATORS[operator.concatTokens().toUpperCase()];
    if (op === undefined) {
      throw notCompiled(`${text}: the operator ${operator.concatTokens()} is not compiled yet`, where);
    }
    condition = lowerComparison(op, sources[0], sources[1], variables, where);
  } else if (sources.length === 3 && words.includes("BETWEEN")) {
    condition = lowerBetween(sources[0], sources[1], sources[2], variables, where);
    if (words.includes("NOT")) {
      condition = { kind: "not", operand: condition };
    }
  } else {
    throw notCompiled(`${text}: only comparisons with = <> < > <= >= and BETWEEN are compiled yet, not IS, IN or other predicates`, where);
  }
  return negate(condition, nots);
}

/**
 * left op right: two data objects or functions of data objects, or with an arithmetic expression on either side, a
 * calculation.
 */
export function lowerComparison(op: IRCompareOp, left: abaplint.Nodes.ExpressionNode, right: abaplint.Nodes.ExpressionNode,
    variables: Variables, where: Where): IRCondition {
  if (isCalculation(left) || isCalculation(right)) {
    const [a, b] = lowerAll(() => calcOperand(left, variables, where), () => calcOperand(right, variables, where));
    return { kind: "compare_calc", op, left: a, right: b };
  }
  const [a, b] = lowerAll(() => comparand(left, variables, where), () => comparand(right, variables, where));
  return { kind: "compare", op, left: a, right: b };
}

/**
 * The operand of CASE: a data object or a built-in function of one, as in a comparison, or an arithmetic expression,
 * calculated on its own before the comparisons.
 */
export function caseOperand(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRComparand {
  return isCalculation(source) ? { kind: "result", expression: lowerArithmetic(source, variables, where) }
    : comparand(source, variables, where);
}

/**
 * A value after WHEN, compared with operand: a data object or abs( ), sqrt( ) or strlen( ) of one. operand is
 * undefined when it is not compiled, so that the values are still looked at.
 */
export function caseValue(operand: IRComparand | undefined, source: abaplint.Nodes.ExpressionNode, variables: Variables,
    where: Where): IRSource | IRFunction {
  const value = comparand(source, variables, where);
  if (operand?.kind === "result" && value.type.kind === "utclong") {
    throw notCompiled(`WHEN ${source.concatTokens()}: a utclong against an arithmetic expression is not compiled yet`, where);
  }
  return value;
}

/**
 * operand BETWEEN low AND high: operand >= low AND operand <= high, so high is not evaluated when operand is less
 * than low. With an arithmetic expression among them, the three share one calculation type.
 */
function lowerBetween(operand: abaplint.Nodes.ExpressionNode, low: abaplint.Nodes.ExpressionNode, high: abaplint.Nodes.ExpressionNode,
    variables: Variables, where: Where): IRCondition {
  if ([operand, low, high].some(isCalculation)) {
    const [value, from, to] = lowerAll(() => calcOperand(operand, variables, where),
      () => calcOperand(low, variables, where), () => calcOperand(high, variables, where));
    return { kind: "between_calc", operand: value, low: from, high: to };
  }
  const [left, right] = lowerAll(() => lowerComparison(">=", operand, low, variables, where),
    () => lowerComparison("<=", operand, high, variables, where));
  return { kind: "and", left, right };
}

/**
 * An operand that makes its comparison a calculation: an arithmetic expression, which a lone function of a data
 * object is not.
 */
function isCalculation(source: abaplint.Nodes.ExpressionNode): boolean {
  return isArithmetic(source) && !isDataObjectFunction(source);
}

/**
 * An operand of a comparison of data objects: a literal, a variable, a subfield, sy-index or a built-in function of
 * one of these.
 */
function comparand(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRSource | IRFunction {
  return isDataObjectFunction(source) ? dataObjectFunction(source, variables, where)
    : lowerSource(source, variables, where, "comparison of");
}

/** abs( ), sqrt( ) or strlen( ) of a data object, with the type of its result. */
function dataObjectFunction(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRFunction {
  const call = lowerArithmetic(source, variables, where);
  if (call.kind === "strlen") {
    return { kind: "function", call, type: { kind: "i" } };
  }
  if (call.kind !== "unary" || call.fn === "-" || call.operand.kind !== "operand") {
    throw new InternalError(`${source.concatTokens()}: not a function of a data object`, where);
  }
  return { kind: "function", call, type: resultType(call.fn, call.operand.source.type) };
}

/**
 * The type of abs( ) or sqrt( ) outside an arithmetic expression. abs( ) has the type of its argument: i for i, b, s,
 * d, t, x and xstring, p for p and for text. sqrt( ) is an f, a decfloat34 for a decimal floating point argument.
 */
function resultType(fn: "abs" | "sqrt", arg: IRType): IRType {
  if (fn === "sqrt") {
    return { kind: arg.kind === "decfloat16" || arg.kind === "decfloat34" ? "decfloat34" : "f" };
  }
  switch (arg.kind) {
    case "int8": case "p": case "f": case "decfloat16": case "decfloat34":
      return arg;
    case "c": case "n": case "string":
      return { kind: "p", length: 16, decimals: 0 };
    default:
      return { kind: "i" };
  }
}

/** A side of a comparison with an arithmetic expression: the expression, or a single operand. */
function calcOperand(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRExpr {
  // a lone function is arithmetic here as well: with an arithmetic expression on the other side, it is calculated with it
  return isArithmetic(source) ? lowerArithmetic(source, variables, where)
    : { kind: "operand", source: lowerSource(source, variables, where, "comparison of") };
}
