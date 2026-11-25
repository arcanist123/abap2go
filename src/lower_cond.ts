import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { IRAssert, IRCompareOp, IRCondition, IRSource } from "./ir";
import { isArithmetic } from "./lower_arith";
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
    throw new BuildError(`${statement.concatTokens()}: only ASSERT <comparison>. is supported yet, no additions`, where);
  }
  return { kind: "assert", condition: lowerCondition(cond, variables, where) };
}

/**
 * A Cond that is one comparison a op b with a relational operator. NOT, AND, OR, EQUIV, the other predicates (IS,
 * BETWEEN, IN, CO, CS, ...) and arithmetic expressions as operands are build errors so far.
 */
export function lowerCondition(cond: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRCondition {
  const text = cond.concatTokens();
  const parts = cond.getChildren();
  const compare = parts[0];
  if (parts.length !== 1 || !(compare instanceof abaplint.Nodes.ExpressionNode) || !(compare.get() instanceof Expressions.Compare)) {
    throw new BuildError(`${text}: only one comparison is supported yet, no NOT, AND, OR, EQUIV or parentheses`, where);
  }
  const [left, operator, right, ...rest] = compare.getChildren();
  if (!(left instanceof abaplint.Nodes.ExpressionNode) || !(left.get() instanceof Expressions.Source)
      || !(operator instanceof abaplint.Nodes.ExpressionNode) || !(operator.get() instanceof Expressions.CompareOperator)
      || !(right instanceof abaplint.Nodes.ExpressionNode) || !(right.get() instanceof Expressions.Source)
      || rest.length !== 0) {
    throw new BuildError(`${text}: only a comparison with = <> < > <= >= is supported yet, not NOT or other predicates`, where);
  }
  const op = OPERATORS[operator.concatTokens().toUpperCase()];
  if (op === undefined) {
    throw new BuildError(`${text}: the operator ${operator.concatTokens()} is not supported yet`, where);
  }
  return { kind: "compare", op, left: lowerComparand(left, variables, where), right: lowerComparand(right, variables, where) };
}

/** An operand of a comparison: a literal, a variable or a subfield. */
function lowerComparand(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRSource {
  if (isArithmetic(source)) {
    throw new BuildError(`${source.concatTokens()}: arithmetic expressions and functions as operands of a comparison are not supported yet`, where);
  }
  return lowerSource(source, variables, where, "comparison of");
}
