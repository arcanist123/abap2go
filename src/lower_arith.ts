import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { IRArithOp, IRCalculate, IRExpr, IRLiteral, IRTarget } from "./ir";
import { integerLiteral, lowerConstant, lowerFieldChain, lowerSource, Variables, Where } from "./lower_common";

const { Expressions } = abaplint;

const OPERATORS: Record<string, IRArithOp> = {
  "+": "+", "-": "-", "*": "*", "/": "/", "DIV": "DIV", "MOD": "MOD", "**": "**",
};

const FUNCTIONS = new Set(["abs", "sqrt", "ipow", "strlen"]);

/**
 * source without the parentheses around a single data object, which are expected to change nothing: ( c ) is the data
 * object c, not an arithmetic expression. Any other source as it is.
 */
export function unparenthesized(source: abaplint.Nodes.ExpressionNode): abaplint.Nodes.ExpressionNode {
  const [open, inner, close, ...rest] = source.getChildren();
  if (open?.concatTokens() === "(" && close?.concatTokens() === ")" && rest.length === 0
      && inner instanceof abaplint.Nodes.ExpressionNode && inner.get() instanceof Expressions.Source) {
    const operand = unparenthesized(inner);
    if (!isArithmetic(operand)) {
      return operand;
    }
  }
  return source;
}

/**
 * A Source that is an arithmetic expression: it has an operator, a sign, a built-in function or parentheses around
 * one of these.
 */
export function isArithmetic(source: abaplint.Nodes.ExpressionNode): boolean {
  if (unparenthesized(source) !== source) {
    return false;
  }
  const children = source.getChildren();
  if (children.length > 1) {
    return source.findDirectExpression(Expressions.ArithOperator) !== undefined
      || isSign(children[0]) || children[0].concatTokens() === "(";
  }
  return functionName(source) !== undefined;
}

/** A Source that is one call of a built-in function (abs, sqrt, ipow, strlen) and nothing else. */
export function isFunctionCall(source: abaplint.Nodes.ExpressionNode): boolean {
  return source.getChildren().length === 1 && functionName(source) !== undefined;
}

/**
 * A Source that is one call of abs( ), sqrt( ) or strlen( ) on a single data object. As an operand of a comparison it
 * is a value of the type of its result, not an arithmetic expression; ipow( ) and a function of an arithmetic
 * expression or of another function are arithmetic expressions there as well.
 */
export function isDataObjectFunction(source: abaplint.Nodes.ExpressionNode): boolean {
  if (!isFunctionCall(source) || functionName(source) === "ipow") {
    return false;
  }
  const param = source.findFirstExpression(Expressions.MethodCallParam);
  const arg = param?.findDirectExpression(Expressions.Source)
    ?? param?.findDirectExpression(Expressions.ParameterListS)?.findDirectExpression(Expressions.ParameterS)
      ?.findDirectExpression(Expressions.Source);
  return arg !== undefined && !isArithmetic(arg);
}

/** target = expression. or target op= expression. (op one of + - * /) as a calculation. */
export function lowerCalculate(target: IRTarget, assignOp: "+" | "-" | "*" | "/" | undefined,
    source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRCalculate {
  let expression = lowerExpression(source, variables, where);
  if (assignOp !== undefined) {
    expression = { kind: "binary", op: assignOp, left: { kind: "operand", source: target }, right: expression };
  }
  return { kind: "calculate", target, expression };
}

/** An arithmetic expression (or a single numeric operand) as an IRExpr. A utclong operand is reported by abaplint. */
export function lowerArithmetic(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRExpr {
  return lowerExpression(source, variables, where);
}

/** A sign token: - or + before an operand. abaplint gives it its own token, outside the operand. */
function isSign(node: abaplint.Nodes.ExpressionNode | abaplint.Nodes.TokenNode): boolean {
  return !(node instanceof abaplint.Nodes.ExpressionNode) && (node.concatTokens() === "-" || node.concatTokens() === "+");
}

type Item =
  | { kind: "operand"; expr: IRExpr }
  | { kind: "operator"; op: IRArithOp }
  | { kind: "sign"; negate: boolean };

/**
 * abaplint parses an arithmetic Source right-recursively: sign* operand [operator Source], where an operand may be
 * ( Source ). The chain is flattened into signs, operands and operators and grouped again by ABAP's priorities.
 */
function lowerExpression(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRExpr {
  const items: Item[] = [];
  flatten(source, variables, where, items);
  return group(items, where);
}

function flatten(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where, items: Item[]): void {
  const children = source.getChildren();
  let i = 0;
  while (children[i] !== undefined && isSign(children[i])) {
    items.push({ kind: "sign", negate: children[i].concatTokens() === "-" });
    i++;
  }
  const first = children[i];
  if (first?.concatTokens() === "(" && !(first instanceof abaplint.Nodes.ExpressionNode)) {
    const inner = children[i + 1];
    if (!(inner instanceof abaplint.Nodes.ExpressionNode) || children[i + 2]?.concatTokens() !== ")") {
      throw new BuildError(`${source.concatTokens()}: unexpected parentheses`, where);
    }
    items.push({ kind: "operand", expr: lowerExpression(inner, variables, where) });
    i += 3;
  } else if (first instanceof abaplint.Nodes.ExpressionNode) {
    items.push(...lowerOperand(first, variables, where));
    i++;
  } else {
    throw new BuildError(`${source.concatTokens()}: not supported in an arithmetic expression yet`, where);
  }

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

/**
 * Recursive descent over the priorities of docs/spec/calculation.md, from the strongest binding: ** (from the
 * right), the sign, * / DIV MOD, + -. So a sign applies to a power, not to its base, also right of **:
 * - a ** b is -( a ** b ) and b ** - c ** b is b ** -( c ** b ).
 */
function group(items: Item[], where: Where): IRExpr {
  let pos = 0;
  const malformed = () => new BuildError("malformed arithmetic expression", where);
  const operatorAt = (ops: IRArithOp[]): IRArithOp | undefined => {
    const item = items[pos];
    return item?.kind === "operator" && ops.includes(item.op) ? item.op : undefined;
  };
  const power = (): IRExpr => {
    const item = items[pos++];
    if (item?.kind !== "operand") {
      throw malformed();
    }
    if (operatorAt(["**"]) === undefined) {
      return item.expr;
    }
    pos++;
    return { kind: "binary", op: "**", left: item.expr, right: signed() };
  };
  const signed = (): IRExpr => {
    const item = items[pos];
    if (item?.kind !== "sign") {
      return power();
    }
    pos++;
    const operand = signed();
    return item.negate ? { kind: "unary", fn: "-", operand } : operand;
  };
  const level = (ops: IRArithOp[], next: () => IRExpr) => (): IRExpr => {
    let left = next();
    for (let op = operatorAt(ops); op !== undefined; op = operatorAt(ops)) {
      pos++;
      left = { kind: "binary", op, left, right: next() };
    }
    return left;
  };
  const e = level(["+", "-"], level(["*", "/", "DIV", "MOD"], signed))();
  if (pos !== items.length) {
    throw malformed();
  }
  return e;
}

/** The built-in function a Source consists of (abs, sqrt, ipow, strlen), undefined if it is something else. */
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

/**
 * A variable or its subfield, a literal (a number beyond the range of i is a p) or abs( ), sqrt( ), ipow( ),
 * strlen( ). A number literal is
 * negative when its minus touches the digits (-7); a minus separated by a blank (- 7) is a sign before 7.
 */
function lowerOperand(node: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): Item[] {
  const operand = (expr: IRExpr): Item => ({ kind: "operand", expr });
  if (node.get() instanceof Expressions.Constant) {
    const literal = numberOrConstant(node, where);
    const integer = node.findDirectExpression(Expressions.Integer);
    const first = integer?.getFirstToken();
    const digits = integer?.getLastToken();
    if (first !== undefined && digits !== undefined && first !== digits && first.getStr() === "-"
        && !first.getEnd().equals(digits.getStart())) {
      const positive = numberOrConstant(node, where, digits.getStr());
      return [{ kind: "sign", negate: true }, operand({ kind: "operand", source: positive })];
    }
    return [operand({ kind: "operand", source: literal })];
  }
  if (node.get() instanceof Expressions.FieldChain) {
    const field = lowerFieldChain(node, variables, where);
    if (field === undefined) {
      throw new BuildError(`${node.concatTokens()}: only variables and their subfields are supported as operands yet`, where);
    }
    return [operand({ kind: "operand", source: field })];
  }
  if (node.get() instanceof Expressions.MethodCallChain) {
    return [operand(lowerFunction(node, variables, where))];
  }
  throw new BuildError(`${node.concatTokens()}: not supported as an operand yet`, where);
}

/** A constant as lowerConstant; text overrides an integer's written form (its digits without the sign). */
function numberOrConstant(constant: abaplint.Nodes.ExpressionNode, where: Where, text?: string): IRLiteral {
  return text !== undefined ? integerLiteral(text) : lowerConstant(constant, where);
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
  // abaplint reports missing, unknown and repeated arguments, so each one asked for is there
  const arg = (n: string): IRExpr => lowerExpression(args.get(n)!, variables, where);
  if (name === "strlen") {
    // a character-like expression position: the argument is not calculated
    return { kind: "strlen", arg: lowerSource(args.get("val")!, variables, where, "strlen( ) of") };
  }
  if (name === "ipow") {
    return { kind: "ipow", base: arg("base"), exp: arg("exp") };
  }
  return { kind: "unary", fn: name as "abs" | "sqrt", operand: arg("val") };
}
