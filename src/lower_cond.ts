import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { IRAssert, IRCompareOp, IRCondition, IRExpr, IRSource, IRType } from "./ir";
import { isArithmetic, isFunctionCall, lowerArithmetic } from "./lower_arith";
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
    throw new BuildError(`${statement.concatTokens()}: only ASSERT <condition>. is supported yet, no additions`, where);
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
  const operands: IRCondition[] = [];
  const joiners: Joiner[] = [];
  for (const child of cond.getChildren()) {
    if (child instanceof abaplint.Nodes.ExpressionNode && child.get() instanceof Expressions.Compare) {
      operands.push(lowerCompare(child, variables, where));
    } else if (child instanceof abaplint.Nodes.ExpressionNode && child.get() instanceof Expressions.CondSub) {
      operands.push(lowerCondSub(child, variables, where));
    } else {
      const word = child.concatTokens().toUpperCase();
      if (word !== "AND" && word !== "OR" && word !== "EQUIV") {
        throw new BuildError(`${cond.concatTokens()}: unexpected ${child.concatTokens()}`, where);
      }
      joiners.push(word.toLowerCase() as Joiner);
    }
  }
  if (operands.length !== joiners.length + 1) {
    throw new BuildError(`${cond.concatTokens()}: malformed logical expression`, where);
  }
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

/** [NOT] ( Cond ). */
function lowerCondSub(sub: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRCondition {
  const inner = sub.findDirectExpression(Expressions.Cond);
  if (inner === undefined) {
    throw new BuildError(`${sub.concatTokens()}: malformed parenthesized condition`, where);
  }
  const condition = lowerCondition(inner, variables, where);
  return sub.getFirstToken().getStr().toUpperCase() === "NOT" ? { kind: "not", operand: condition } : condition;
}

/**
 * A relational expression, perhaps with NOT before it: a comparison with = <> < > <= >= or [NOT] BETWEEN. The other
 * predicates (IS, IN, CO, CS, ...) are build errors so far.
 */
function lowerCompare(compare: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRCondition {
  const text = compare.concatTokens();
  let children = compare.getChildren();
  let negated = false;
  if (children[0]?.concatTokens().toUpperCase() === "NOT" && !(children[0] instanceof abaplint.Nodes.ExpressionNode)) {
    negated = true;
    children = children.slice(1);
  }
  const words = children.map(c => c instanceof abaplint.Nodes.ExpressionNode ? undefined : c.concatTokens().toUpperCase());
  const sources = children.filter((c): c is abaplint.Nodes.ExpressionNode =>
    c instanceof abaplint.Nodes.ExpressionNode && c.get() instanceof Expressions.Source);
  const operator = children[1];

  let condition: IRCondition;
  if (children.length === 3 && sources.length === 2 && operator instanceof abaplint.Nodes.ExpressionNode
      && operator.get() instanceof Expressions.CompareOperator) {
    const op = OPERATORS[operator.concatTokens().toUpperCase()];
    if (op === undefined) {
      throw new BuildError(`${text}: the operator ${operator.concatTokens()} is not supported yet`, where);
    }
    condition = lowerComparison(op, sources[0], sources[1], variables, where);
  } else if (sources.length === 3 && words.includes("BETWEEN")) {
    condition = lowerBetween(sources[0], sources[1], sources[2], variables, where);
    if (words.includes("NOT")) {
      condition = { kind: "not", operand: condition };
    }
  } else {
    throw new BuildError(`${text}: only comparisons with = <> < > <= >= and BETWEEN are supported yet, not IS, IN or other predicates`, where);
  }
  return negated ? { kind: "not", operand: condition } : condition;
}

/** left op right: two data objects, or with an arithmetic expression on either side, a calculation. */
export function lowerComparison(op: IRCompareOp, left: abaplint.Nodes.ExpressionNode, right: abaplint.Nodes.ExpressionNode,
    variables: Variables, where: Where): IRCondition {
  if (isArithmetic(left) || isArithmetic(right)) {
    // also when a side is a lone built-in function: calcOperand refuses it
    return { kind: "compare_calc", op, left: calcOperand(left, variables, where), right: calcOperand(right, variables, where) };
  }
  const l = comparand(left, variables, where);
  const r = comparand(right, variables, where);
  checkComparable(l, r, where);
  return { kind: "compare", op, left: l, right: r };
}

/**
 * operand BETWEEN low AND high: operand >= low AND operand <= high, so high is not evaluated when operand is less
 * than low. With an arithmetic expression among them, the three share one calculation type.
 */
function lowerBetween(operand: abaplint.Nodes.ExpressionNode, low: abaplint.Nodes.ExpressionNode, high: abaplint.Nodes.ExpressionNode,
    variables: Variables, where: Where): IRCondition {
  if ([operand, low, high].some(isArithmetic)) {
    return {
      kind: "between_calc",
      operand: calcOperand(operand, variables, where),
      low: calcOperand(low, variables, where),
      high: calcOperand(high, variables, where),
    };
  }
  return {
    kind: "and",
    left: lowerComparison(">=", operand, low, variables, where),
    right: lowerComparison("<=", operand, high, variables, where),
  };
}

/** An operand of a comparison of data objects: a literal, a variable, a subfield or sy-index. */
function comparand(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRSource {
  return lowerSource(source, variables, where, "comparison of");
}

const NUMERIC = new Set<IRType["kind"]>(["i", "int8", "b", "s", "p", "f", "decfloat16", "decfloat34"]);

/**
 * A side of a comparison with an arithmetic expression: the expression, or a single operand, which must be numeric
 * (a text, date, time, byte or time stamp operand is a syntax error there; with a sign it is an expression itself).
 */
function calcOperand(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRExpr {
  if (isArithmetic(source)) {
    if (isFunctionCall(source)) {
      // a functional operand with the type of its result, not an arithmetic expression
      throw new BuildError(`${source.concatTokens()}: a built-in function as an operand of a comparison is not supported yet`, where);
    }
    return lowerArithmetic(source, variables, where);
  }
  const single = lowerSource(source, variables, where, "comparison of");
  if (!NUMERIC.has(single.type.kind)) {
    throw new BuildError(`${source.concatTokens()}: a ${single.type.kind} operand cannot be compared with an arithmetic expression`, where);
  }
  return { kind: "operand", source: single };
}

/** Two kinds without a comparison type are a syntax error: d with t, utclong with anything but c, string, utclong. */
function checkComparable(left: IRSource, right: IRSource, where: Where): void {
  const [a, b] = [left.type.kind, right.type.kind];
  const dateTime = (a === "d" && b === "t") || (a === "t" && b === "d");
  const utclong = (x: string, y: string) => x === "utclong" && !["c", "string", "utclong"].includes(y);
  if (dateTime || utclong(a, b) || utclong(b, a)) {
    throw new BuildError(`a comparison of ${a} with ${b} is not possible: the types have no comparison type`, where);
  }
}
