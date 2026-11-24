import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { IRData, IRLiteral, IRMove, IRSource, IRType, IRVariable } from "./ir";

const { Expressions, BasicTypes } = abaplint;

export type Where = { file: string; row: number; col: number };

export function position(file: abaplint.ABAPFile, node: abaplint.Nodes.StatementNode | abaplint.Nodes.ExpressionNode): Where {
  const start = node.getFirstToken().getStart();
  return { file: file.getFilename(), row: start.getRow(), col: start.getCol() };
}

/** Comments and empty statements, which do nothing. */
export function isNoop(statement: abaplint.Nodes.StatementNode): boolean {
  const kind = statement.get();
  return kind instanceof abaplint.Comment || kind instanceof abaplint.Empty;
}

/** A literal as written in the source. */
export interface Literal {
  /** A text field literal '...' (type c) or a string literal `...` (type string). */
  type: "c" | "string";
  /** Its characters, quotes removed and doubled quotes undone. A text field literal '' holds one blank. */
  value: string;
}

function textLiteral(literal: abaplint.Nodes.ExpressionNode): Literal {
  const raw = literal.getFirstToken().getStr();
  const quote = raw[0];
  const value = raw.slice(1, -1).split(quote + quote).join(quote);
  if (quote === "'") {
    return { type: "c", value: value === "" ? " " : value };
  }
  return { type: "string", value };
}

/**
 * The variables of one ABAP object, typed by abaplint's syntax check. The compiler's types come from here, so a
 * type abaplint does not know (b and s, for instance, which only come from DDIC types such as INT1 and INT2) is a
 * build error, never a guess.
 */
export class Variables {
  private readonly spaghetti: abaplint.ISpaghettiScope;

  constructor(registry: abaplint.IRegistry, obj: abaplint.ABAPObject, private readonly file: abaplint.ABAPFile) {
    this.spaghetti = new abaplint.SyntaxLogic(registry, obj).run().spaghetti;
  }

  /** The variable name as visible at node, or a build error. */
  find(name: string, node: abaplint.Nodes.StatementNode | abaplint.Nodes.ExpressionNode, where: Where): IRVariable {
    const scope = this.spaghetti.lookupPosition(node.getFirstToken().getStart(), this.file.getFilename());
    const found = scope?.findVariable(name);
    if (found === undefined) {
      throw new BuildError(`${name}: variable not found`, where);
    }
    return { kind: "variable", name: name.toLowerCase(), type: irType(found.getType(), name, where) };
  }
}

/** The elementary type abaplint gives a variable; anything else is a build error. */
export function irType(type: abaplint.AbstractType, name: string, where: Where): IRType {
  if (type instanceof BasicTypes.CharacterType) {
    return { kind: "c", length: type.getLength() };
  } else if (type instanceof BasicTypes.NumericType) {
    return { kind: "n", length: type.getLength() };
  } else if (type instanceof BasicTypes.HexType) {
    return { kind: "x", length: type.getLength() };
  } else if (type instanceof BasicTypes.PackedType) {
    return { kind: "p", length: type.getLength(), decimals: type.getDecimals() };
  } else if (type instanceof BasicTypes.DateType) {
    return { kind: "d" };
  } else if (type instanceof BasicTypes.TimeType) {
    return { kind: "t" };
  } else if (type instanceof BasicTypes.StringType) {
    return { kind: "string" };
  } else if (type instanceof BasicTypes.XStringType) {
    return { kind: "xstring" };
  } else if (type instanceof BasicTypes.IntegerType) {
    return { kind: "i" };
  } else if (type instanceof BasicTypes.Integer8Type) {
    return { kind: "int8" };
  } else if (type instanceof BasicTypes.FloatType) {
    return { kind: "f" };
  } else if (type instanceof BasicTypes.DecFloat16Type) {
    return { kind: "decfloat16" };
  } else if (type instanceof BasicTypes.DecFloat34Type) {
    return { kind: "decfloat34" };
  } else if (type instanceof BasicTypes.UTCLongType) {
    return { kind: "utclong" };
  }
  // b and s go here once abaplint types them.
  throw new BuildError(`${name}: type ${type.toText(0)} is not supported yet, only elementary types`, where);
}

const SIMPLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A Source that is a literal or a variable, or a build error. */
export function lowerSource(source: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where, what: string): IRSource {
  const constant = source.getChildren().length === 1 ? source.findDirectExpression(Expressions.Constant) : undefined;
  if (constant !== undefined) {
    return lowerConstant(constant, where);
  }
  const text = source.concatTokens();
  if (SIMPLE_NAME.test(text)) {
    return variables.find(text, source, where);
  }
  throw new BuildError(`${what} ${text}: only a literal or a variable is supported yet`, where);
}

/** A Constant: a text field literal, a string literal (no & chains) or an integer within the range of i. */
export function lowerConstant(constant: abaplint.Nodes.ExpressionNode, where: Where): IRLiteral {
  const text = constant.findDirectExpression(Expressions.ConstantString);
  if (text !== undefined && text.getChildren().length === 1) {
    const literal = textLiteral(text);
    return literal.type === "c"
      ? { kind: "literal", type: { kind: "c", length: [...literal.value].length }, value: literal.value }
      : { kind: "literal", type: { kind: "string" }, value: literal.value };
  }
  const integer = constant.findDirectExpression(Expressions.Integer);
  if (integer !== undefined) {
    const digits = integer.concatTokens().replace(/\s+/g, "");
    const value = BigInt(digits);
    if (value >= -(2n ** 31n) && value < 2n ** 31n) {
      return { kind: "literal", type: { kind: "i" }, value: value.toString() };
    }
    throw new BuildError(`${digits}: numeric literals beyond the range of i are not supported yet`, where);
  }
  throw new BuildError(`${constant.concatTokens()}: this literal is not supported yet`, where);
}

/** DATA name TYPE elementary [VALUE literal | VALUE IS INITIAL]. */
export function lowerData(statement: abaplint.Nodes.StatementNode, variables: Variables, where: Where): IRData {
  const name = statement.findFirstExpression(Expressions.DefinitionName)?.concatTokens();
  if (name === undefined) {
    throw new BuildError(`${statement.concatTokens()}: not supported yet`, where);
  }
  const variable = variables.find(name, statement, where);
  const valueNode = statement.findFirstExpression(Expressions.Value);
  let value: IRLiteral | undefined;
  if (valueNode !== undefined && !/^VALUE\s+IS\s+INITIAL$/i.test(valueNode.concatTokens())) {
    const constant = valueNode.findDirectExpression(Expressions.Constant);
    if (constant === undefined) {
      throw new BuildError(`${valueNode.concatTokens()}: only a literal is supported as VALUE yet`, where);
    }
    value = lowerConstant(constant, where);
  }
  return { kind: "data", variable, value };
}

/** target = source. with a variable as target and a literal or variable as source. */
export function lowerMove(statement: abaplint.Nodes.StatementNode, variables: Variables, where: Where): IRMove {
  const targets = statement.findDirectExpressions(Expressions.Target);
  const sources = statement.findDirectExpressions(Expressions.Source);
  const target = targets[0]?.concatTokens() ?? "";
  if (targets.length !== 1 || sources.length !== 1 || !SIMPLE_NAME.test(target)
      || statement.getChildren().length !== 4 || statement.getChildren()[1].concatTokens() !== "=") {
    throw new BuildError(`${statement.concatTokens()}: only variable = literal or variable is supported yet`, where);
  }
  return {
    kind: "move",
    target: variables.find(target, statement, where),
    source: lowerSource(sources[0], variables, where, "assignment of"),
  };
}
