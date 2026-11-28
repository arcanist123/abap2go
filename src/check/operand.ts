// What an operand is, read from its syntax tree: parentheses, calls of built-in functions and calculations.

import * as abaplint from "@abaplint/core";
import { CheckInput } from "./input";

const { Expressions, BasicTypes, Nodes } = abaplint;

type ExpressionNode = abaplint.Nodes.ExpressionNode;

/** The numeric functions of one argument, which of a data object are values of their own. */
const UNARY_FUNCTIONS = new Set(["abs", "acos", "asin", "atan", "ceil", "cos", "cosh", "exp", "floor", "frac", "log",
  "log10", "sign", "sin", "sinh", "sqrt", "tan", "tanh", "trunc"]);
/** The numeric functions with further parameters, which are always calculated. */
const CALCULATION_FUNCTIONS = new Set(["ipow", "nmax", "nmin", "rescale", "round"]);
const LENGTH_FUNCTIONS = new Set(["numofchar", "strlen", "xstrlen"]);

/** A call of a built-in function. */
export interface BuiltInCall {
  /** the name as written */
  readonly name: string;
  readonly node: ExpressionNode;
}

/** The text of a child that is a token, upper case; undefined for an expression. */
export function word(node: abaplint.INode | undefined): string | undefined {
  return node instanceof Nodes.TokenNode ? node.getFirstToken().getStr().toUpperCase() : undefined;
}

/** The source inside the parentheses when the source is exactly "( ... )". */
export function parenthesized(source: ExpressionNode): ExpressionNode | undefined {
  const [open, inner, ...rest] = source.getChildren();
  if (rest.length === 1 && word(open) === "(" && inner instanceof Nodes.ExpressionNode
      && inner.get() instanceof Expressions.Source) {
    return inner;
  }
  return undefined;
}

export function withoutParentheses(source: ExpressionNode): ExpressionNode {
  const inner = parenthesized(source);
  return inner === undefined ? source : withoutParentheses(inner);
}

/**
 * The call of a built-in function when the source is exactly that one call. abaplint's reference tells it from a call
 * of a method of the same name, which hides the function.
 */
export function builtInCall(source: ExpressionNode, input: CheckInput): BuiltInCall | undefined {
  const [chain, ...rest] = source.getChildren();
  if (rest.length > 0 || !(chain instanceof Nodes.ExpressionNode) || !(chain.get() instanceof Expressions.MethodCallChain)) {
    return undefined;
  }
  const [node, ...more] = chain.getChildren();
  if (more.length > 0 || !(node instanceof Nodes.ExpressionNode) || !(node.get() instanceof Expressions.MethodCall)) {
    return undefined;
  }
  const nameNode = node.findDirectExpression(Expressions.MethodName);
  if (nameNode === undefined) {
    return undefined;
  }
  const start = nameNode.getFirstToken().getStart();
  const filename = input.file.getFilename();
  for (let scope = input.spaghetti.lookupPosition(start, filename); scope !== undefined; scope = scope.getParent()) {
    const found = scope.getData().references.some(r => r.referenceType === abaplint.ReferenceType.BuiltinMethodReference
      && r.position.getFilename() === filename && r.position.getStart().equals(start));
    if (found) {
      return { name: nameNode.concatTokens().replace(/^!/, ""), node };
    }
  }
  return undefined;
}

/** Whether the function has a numeric result. */
export function isNumericFunction(call: BuiltInCall): boolean {
  const type = returnType(call);
  return type instanceof BasicTypes.IntegerType || type instanceof BasicTypes.FloatType
    || type instanceof BasicTypes.DecFloat34Type;
}

/** The type abaplint declares as the result of the function. */
export function returnType(call: BuiltInCall): abaplint.AbstractType | undefined {
  return abaplint.BuiltIn.searchBuiltin(call.name.toUpperCase())?.getParameters().getReturning()?.getType();
}

/** The argument of a call with one unnamed argument. */
export function unnamedArgument(call: BuiltInCall): ExpressionNode | undefined {
  return call.node.findDirectExpression(Expressions.MethodCallParam)?.findDirectExpression(Expressions.Source);
}

/** The arguments of the call, unnamed or named, abs( a ) or ipow( base = a exp = 2 ). */
function callArguments(call: BuiltInCall): ExpressionNode[] {
  const unnamed = unnamedArgument(call);
  if (unnamed !== undefined) {
    return [unnamed];
  }
  const list = call.node.findDirectExpression(Expressions.MethodCallParam)?.findDirectExpression(Expressions.ParameterListS);
  return (list?.findDirectExpressions(Expressions.ParameterS) ?? [])
    .map(p => p.findDirectExpression(Expressions.Source))
    .filter((s): s is ExpressionNode => s !== undefined);
}

/** A literal, a text symbol, or a field with components, offset and length or dereferenced, not an expression. */
export function isDataObject(source: ExpressionNode): boolean {
  const children = source.getChildren();
  if (children.length === 1
      && (children[0].get() instanceof Expressions.Constant || children[0].get() instanceof Expressions.TextElement)) {
    return true;
  }
  return children.length > 0
    && children[0].get() instanceof Expressions.FieldChain
    && children.every(c => c.get() instanceof Expressions.FieldChain || c.get() instanceof Expressions.Dereference)
    && source.findFirstExpression(Expressions.TableExpression) === undefined;
}

/** a && b, a & b of anything but literals, or a string template. */
export function isStringExpression(source: ExpressionNode): boolean {
  const children = source.getChildren();
  return children.some(c => ["&", "&&"].includes(word(c) ?? ""))
    || children[0]?.get() instanceof Expressions.StringTemplate;
}

/** The operator of a BIT- expression: x BIT-AND y, BIT-NOT x. */
export function isBitExpression(source: ExpressionNode): boolean {
  // the lexer splits BIT-NOT into three tokens
  return (word(source.getChildren()[0]) !== undefined && /^BIT-NOT /i.test(source.concatTokens()))
    || source.getChildren().some(c => c.get() instanceof Expressions.ArithOperator && isBitOperator(c));
}

function isBitOperator(node: abaplint.INode): boolean {
  return node instanceof Nodes.ExpressionNode && node.concatTokens().toUpperCase().startsWith("BIT-");
}

/** A sign or an arithmetic operator at the top of the source. */
function hasArithmeticOperator(source: ExpressionNode): boolean {
  const children = source.getChildren();
  return ["+", "-"].includes(word(children[0]) ?? "")
    || children.some(c => c.get() instanceof Expressions.ArithOperator && !isBitOperator(c));
}

/**
 * a + b, - a, ( a * b ), ipow( base = a exp = b ) or abs( a + b ), but not ( a ), abs( a ), a && b or a BIT-AND b. A
 * numeric function of a data object is a value of its own; with several parameters, or with a calculated argument or
 * another function of one argument as its argument, it is part of a calculation.
 */
export function isArithmetic(source: ExpressionNode, input: CheckInput): boolean {
  const inner = parenthesized(source);
  if (inner !== undefined) {
    return isArithmetic(inner, input);
  }
  if (hasArithmeticOperator(source)) {
    return true;
  }
  const call = builtInCall(source, input);
  if (call === undefined) {
    return false;
  }
  const name = call.name.toLowerCase();
  if (CALCULATION_FUNCTIONS.has(name)) {
    return true;
  }
  const argument = unnamedArgument(call);
  if (!UNARY_FUNCTIONS.has(name) || argument === undefined) {
    return false;
  }
  const nested = builtInCall(argument, input)?.name.toLowerCase();
  return isArithmetic(argument, input)
    || (nested !== undefined && (UNARY_FUNCTIONS.has(nested) || LENGTH_FUNCTIONS.has(nested)));
}

/**
 * What parentheses after CASE may enclose: a + 1, - a, BIT-NOT x, x BIT-AND y, or a numeric function of a calculated
 * argument, abs( a + 1 ), strlen( lcl=>get( ) ). Not a single operand: a data object, a method call, a constructor
 * or table expression, a function of data objects only, or a string expression.
 */
export function isCalculation(source: ExpressionNode, input: CheckInput): boolean {
  const inner = parenthesized(source);
  if (inner !== undefined) {
    return isCalculation(inner, input);
  }
  if (hasArithmeticOperator(source) || isBitExpression(source)) {
    return true;
  }
  const call = builtInCall(source, input);
  return call !== undefined && isNumericFunction(call) && callArguments(call).some(a => isCalculatedArgument(a, input));
}

/** An argument that makes a function a calculation: anything but a data object or a string expression. */
function isCalculatedArgument(argument: ExpressionNode, input: CheckInput): boolean {
  const inner = parenthesized(argument);
  if (inner !== undefined) {
    return isCalculation(inner, input);
  }
  if (isDataObject(argument) || isStringExpression(argument)
      || ["BOOLC", "XSDBOOL"].includes(word(argument.getChildren()[0]) ?? "")) {
    return false;
  }
  const call = builtInCall(argument, input);
  return call === undefined || isNumericFunction(call);
}

/**
 * An operand that makes its comparison a calculation: an arithmetic expression, or a numeric function that is more
 * than a function of a single data object, abs( a + 1 ), abs( lcl=>get( ) ) or ipow( base = a exp = 2 ).
 */
export function isCalculationOperand(source: ExpressionNode, input: CheckInput): boolean {
  const operand = withoutParentheses(source);
  if (hasArithmeticOperator(operand)) {
    return true;
  }
  const call = builtInCall(operand, input);
  if (call === undefined || !isNumericFunction(call)) {
    return false;
  }
  const argument = unnamedArgument(call);
  return argument === undefined || !isDataObject(withoutParentheses(argument));
}
