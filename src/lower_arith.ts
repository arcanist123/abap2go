import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { IRArithOp, IRCalculate, IRExpr, IRLiteral, IRVariable } from "./ir";
import { lowerConstant, Variables, Where } from "./lower_common";

const { Expressions } = abaplint;

const OPERATORS: Record<string, IRArithOp> = {
  "+": "+", "-": "-", "*": "*", "/": "/", "DIV": "DIV", "MOD": "MOD", "**": "**",
};

/** Priority of the binary operators: ** binds strongest and groups from the right. */
const PRIORITY: Record<IRArithOp, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "DIV": 2, "MOD": 2, "**": 3 };

const FUNCTIONS = new Set(["abs", "sqrt", "ipow"]);

/** A Source that is an arithmetic expression: it has an operator, a sign, parentheses or a numeric function. */
export function isArithmetic(source: abaplint.Nodes.ExpressionNode): boolean {
  const children = source.getChildren();
  if (children.length > 1) {
    return source.findDirectExpression(Expressions.ArithOperator) !== undefined
      || children[0].concatTokens() === "-" || children[0].concatTokens() === "(";
  }
  return functionName(source) !== undefined;
}

/** target = expression. or target op= expression. (op one of + - * /) as a calculation. */
export function lowerCalculate(target: IRVariable, assignOp: "+" | "-" | "*" | "/" | undefined,
    source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRCalculate {
  let expression = lowerExpression(source, variables, where);
  if (assignOp !== undefined) {
    expression = { kind: "binary", op: assignOp, left: { kind: "operand", source: target }, right: expression };
  }
  checkOperands(expression, where);
  return { kind: "calculate", target, expression };
}

/** An operand of utclong is a syntax error in ABAP; abaplint is not relied upon to report it. */
function checkOperands(e: IRExpr, where: Where): void {
  switch (e.kind) {
    case "operand":
      if (e.source.type.kind === "utclong") {
        throw new BuildError(`${e.source.kind === "variable" ? e.source.name : "literal"}: utclong cannot be an operand of an arithmetic expression`, where);
      }
      return;
    case "binary":
      checkOperands(e.left, where);
      checkOperands(e.right, where);
      return;
    case "unary":
      checkOperands(e.operand, where);
      return;
    case "ipow":
      checkOperands(e.base, where);
      checkOperands(e.exp, where);
      return;
  }
}

type Item = { kind: "operand"; expr: IRExpr } | { kind: "operator"; op: IRArithOp };

/**
 * abaplint parses an arithmetic Source right-recursively: [-] operand [operator Source], where an operand may be
 * ( Source ). The chain is flattened into operands and operators and grouped again by ABAP's priorities.
 */
function lowerExpression(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRExpr {
  const items: Item[] = [];
  flatten(source, variables, where, items);
  return group(items, where);
}

function flatten(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where, items: Item[]): void {
  const children = source.getChildren();
  let i = 0;
  let negate = false;
  if (children[i]?.concatTokens() === "-" && !(children[i] instanceof abaplint.Nodes.ExpressionNode)) {
    negate = true;
    i++;
  }
  let operand: IRExpr;
  const first = children[i];
  if (first?.concatTokens() === "(" && !(first instanceof abaplint.Nodes.ExpressionNode)) {
    const inner = children[i + 1];
    if (!(inner instanceof abaplint.Nodes.ExpressionNode) || children[i + 2]?.concatTokens() !== ")") {
      throw new BuildError(`${source.concatTokens()}: unexpected parentheses`, where);
    }
    operand = lowerExpression(inner, variables, where);
    i += 3;
  } else if (first instanceof abaplint.Nodes.ExpressionNode) {
    operand = lowerOperand(first, variables, where);
    i++;
  } else {
    throw new BuildError(`${source.concatTokens()}: not supported in an arithmetic expression yet`, where);
  }
  items.push({ kind: "operand", expr: negate ? { kind: "unary", fn: "-", operand } : operand });

  const op = children[i];
  if (op === undefined) {
    return;
  }
  const rest = children[i + 1];
  const opText = op.concatTokens().toUpperCase();
  if (!(op instanceof abaplint.Nodes.ExpressionNode) || !(op.get() instanceof Expressions.ArithOperator)
      || OPERATORS[opText] === undefined || !(rest instanceof abaplint.Nodes.ExpressionNode)
      || !(rest.get() instanceof Expressions.Source) || i + 2 !== children.length) {
    throw new BuildError(`${source.concatTokens()}: not supported in an arithmetic expression yet`, where);
  }
  items.push({ kind: "operator", op: OPERATORS[opText] });
  flatten(rest, variables, where, items);
}

/** Precedence climbing over operand (operator operand)*. */
function group(items: Item[], where: Where): IRExpr {
  let pos = 0;
  const operandAt = (): IRExpr => {
    const item = items[pos++];
    if (item?.kind !== "operand") {
      throw new BuildError("malformed arithmetic expression", where);
    }
    return item.expr;
  };
  const climb = (minPriority: number): IRExpr => {
    let left = operandAt();
    for (;;) {
      const item = items[pos];
      if (item?.kind !== "operator" || PRIORITY[item.op] < minPriority) {
        return left;
      }
      pos++;
      const rightAssoc = item.op === "**";
      const right = climb(rightAssoc ? PRIORITY[item.op] : PRIORITY[item.op] + 1);
      left = { kind: "binary", op: item.op, left, right };
    }
  };
  const e = climb(1);
  if (pos !== items.length) {
    throw new BuildError("malformed arithmetic expression", where);
  }
  return e;
}

/** The built-in function a Source consists of (abs, sqrt, ipow), undefined if it is something else. */
function functionName(node: abaplint.Nodes.ExpressionNode): string | undefined {
  const chain = node.get() instanceof Expressions.MethodCallChain ? node : node.findDirectExpression(Expressions.MethodCallChain);
  if (chain === undefined || (node !== chain && node.getChildren().length !== 1)) {
    return undefined;
  }
  const calls = chain.getChildren();
  if (calls.length !== 1 || !(calls[0] instanceof abaplint.Nodes.ExpressionNode) || !(calls[0].get() instanceof Expressions.MethodCall)) {
    return undefined;
  }
  const name = calls[0].findDirectExpression(Expressions.MethodName)?.concatTokens().toLowerCase();
  return name !== undefined && FUNCTIONS.has(name) ? name : undefined;
}

/** A variable, a literal (a number beyond the range of i is a p) or abs( ), sqrt( ), ipow( ). */
function lowerOperand(node: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRExpr {
  if (node.get() instanceof Expressions.Constant) {
    return { kind: "operand", source: numberOrConstant(node, where) };
  }
  if (node.get() instanceof Expressions.FieldChain) {
    const text = node.concatTokens();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
      throw new BuildError(`${text}: only variables are supported as operands yet`, where);
    }
    return { kind: "operand", source: variables.find(text, node, where) };
  }
  if (node.get() instanceof Expressions.MethodCallChain) {
    return lowerFunction(node, variables, where);
  }
  throw new BuildError(`${node.concatTokens()}: not supported as an operand yet`, where);
}

/** An integer literal beyond the range of i has type p; any other constant as lowerConstant. */
function numberOrConstant(constant: abaplint.Nodes.ExpressionNode, where: Where): IRLiteral {
  const integer = constant.findDirectExpression(Expressions.Integer);
  if (integer !== undefined) {
    const digits = integer.concatTokens().replace(/\s+/g, "");
    const value = BigInt(digits);
    if (value < -(2n ** 31n) || value >= 2n ** 31n) {
      if (digits.replace(/^-/, "").length > 31) {
        throw new BuildError(`${digits}: more than 31 digits`, where);
      }
      return { kind: "literal", type: { kind: "p", length: 16, decimals: 0 }, value: value.toString() };
    }
  }
  return lowerConstant(constant, where);
}

function lowerFunction(node: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRExpr {
  const name = functionName(node);
  if (name === undefined) {
    throw new BuildError(`${node.concatTokens()}: method calls are not supported in arithmetic expressions yet`, where);
  }
  if (variables.hasMethod(name)) {
    throw new BuildError(`${name}( ): a method of the same name hides the built-in function; not supported yet`, where);
  }
  const param = node.findFirstExpression(Expressions.MethodCallParam);
  const args = new Map<string, abaplint.Nodes.ExpressionNode>();
  const single = param?.findDirectExpression(Expressions.Source);
  if (single !== undefined) {
    args.set("val", single);
  }
  for (const p of param?.findDirectExpression(Expressions.ParameterListS)?.findDirectExpressions(Expressions.ParameterS) ?? []) {
    const pName = p.findDirectExpression(Expressions.ParameterName)?.concatTokens().toLowerCase();
    const pSource = p.findDirectExpression(Expressions.Source);
    if (pName !== undefined && pSource !== undefined) {
      args.set(pName, pSource);
    }
  }
  const arg = (n: string): IRExpr => {
    const s = args.get(n);
    if (s === undefined) {
      throw new BuildError(`${node.concatTokens()}: parameter ${n} missing`, where);
    }
    return lowerExpression(s, variables, where);
  };
  if (name === "ipow") {
    if (args.size !== 2) {
      throw new BuildError(`${node.concatTokens()}: ipow( base = ... exp = ... ) expected`, where);
    }
    return { kind: "ipow", base: arg("base"), exp: arg("exp") };
  }
  if (args.size !== 1) {
    throw new BuildError(`${node.concatTokens()}: ${name}( ) takes one argument`, where);
  }
  return { kind: "unary", fn: name as "abs" | "sqrt", operand: arg("val") };
}
