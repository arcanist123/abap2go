import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { IRCalculate, IRData, IRLiteral, IRMove, IRSource, IRSubstring, IRSystemField, IRTarget, IRType, IRVariable } from "./ir";
import { isArithmetic, lowerCalculate, unparenthesized } from "./lower_arith";

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
 * Where the type of a variable comes from, as far as WRITE cares: a built-in type has the output length of
 * docs/spec/write.md, a data element brings its own.
 */
export type TypeOrigin =
  | { kind: "builtin" }
  | { kind: "data_element"; name: string }
  | { kind: "other"; text: string };

const BUILTIN_TYPE = /^(c|n|x|p|d|t|i|int8|f|decfloat16|decfloat34|string|xstring|utclong)$/i;

/**
 * The variables of one ABAP object, typed by abaplint's syntax check. The compiler's types come from here, so a
 * type abaplint does not know is a build error, never a guess. b and s only come from DDIC types (INT1, INT2).
 */
export class Variables {
  private readonly spaghetti: abaplint.ISpaghettiScope;
  private readonly origins = new Map<string, TypeOrigin>();

  /** methods: the method names of the class being lowered, lower case; a method hides a built-in function. */
  constructor(readonly registry: abaplint.IRegistry, obj: abaplint.ABAPObject, private readonly file: abaplint.ABAPFile,
      private readonly methods: ReadonlySet<string> = new Set()) {
    this.spaghetti = new abaplint.SyntaxLogic(registry, obj).run().spaghetti;
  }

  /** A method of this name is visible, so name( ) calls it, not a built-in function. */
  hasMethod(name: string): boolean {
    return this.methods.has(name.toLowerCase());
  }

  /** Records where the type of a declared variable comes from, from its DATA statement. */
  declare(name: string, statement: abaplint.Nodes.StatementNode): void {
    const text = statement.concatTokens();
    const typeName = /\bTYPE\s+([^\s.]+)/i.exec(text)?.[1];
    let origin: TypeOrigin;
    if (/\bLIKE\b/i.test(text)) {
      origin = { kind: "other", text: "LIKE" };
    } else if (typeName === undefined || BUILTIN_TYPE.test(typeName)) {
      origin = { kind: "builtin" };
    } else if (this.registry.getObject("DTEL", typeName.toUpperCase()) !== undefined) {
      origin = { kind: "data_element", name: typeName.toUpperCase() };
    } else {
      origin = { kind: "other", text: typeName };
    }
    this.origins.set(name.toLowerCase(), origin);
  }

  /**
   * A build error unless WRITE formats the variable by the rules of docs/spec/write.md: a built-in type, or a
   * data element with the output length of its built-in type and no conversion exit (the sign flag of a domain
   * does not change the output).
   */
  checkWriteFormat(v: IRVariable, where: Where): void {
    const origin = this.origins.get(v.name) ?? { kind: "other", text: "an unknown declaration" };
    if (origin.kind === "builtin") {
      return;
    }
    if (origin.kind === "other") {
      throw new BuildError(`WRITE of ${v.name}: typed with ${origin.text}; only built-in types and data elements are supported yet`, where);
    }
    const dtel = this.registry.getObject("DTEL", origin.name);
    const dtelXML = dtel?.getXML() ?? "";
    const domainName = xmlField(dtelXML, "DOMNAME");
    const attributes = domainName === "" ? dtelXML : this.registry.getObject("DOMA", domainName)?.getXML();
    if (attributes === undefined) {
      throw new BuildError(`WRITE of ${v.name}: domain ${domainName} of data element ${origin.name} not found`, where);
    }
    const convexit = xmlField(attributes, "CONVEXIT");
    if (convexit !== "") {
      throw new BuildError(`WRITE of ${v.name}: conversion exit ${convexit} of data element ${origin.name} is not supported yet`, where);
    }
    const builtin = outputLength(v.type);
    const outputLen = parseInt(xmlField(attributes, "OUTPUTLEN") || "0", 10);
    if (builtin === undefined || outputLen !== builtin) {
      throw new BuildError(`WRITE of ${v.name}: data element ${origin.name} has output length ${outputLen}, `
        + `only the output length of the built-in type (${builtin ?? "none"}) is supported yet`, where);
    }
  }

  /** The variable name as visible at node, or a build error. */
  find(name: string, node: abaplint.Nodes.StatementNode | abaplint.Nodes.ExpressionNode, where: Where): IRVariable {
    const scope = this.spaghetti.lookupPosition(node.getFirstToken().getStart(), this.file.getFilename());
    const found = scope?.findVariable(name);
    if (found === undefined) {
      throw new BuildError(`${name}: variable not found`, where);
    }
    // built-in data objects (abap_true, space, sy) and constants are not variables of the root
    if (found.getFilename() !== this.file.getFilename() || found.getMeta().includes("read_only" as abaplint.IdentifierMeta)) {
      throw new BuildError(`${name}: only variables declared with DATA in the root are supported yet, not constants or built-in data objects`, where);
    }
    return { kind: "variable", name: name.toLowerCase(), type: irType(found.getType(), name, where) };
  }
}

/** The value of an element of abapGit XML, "" if it is missing. */
function xmlField(xml: string, field: string): string {
  return new RegExp(`<${field}>([^<]*)</${field}>`).exec(xml)?.[1].trim() ?? "";
}

/** The output length WRITE gives a built-in type (docs/spec/write.md); undefined for string and xstring. */
export function outputLength(t: IRType): number | undefined {
  switch (t.kind) {
    case "c": case "n": return t.length;
    case "x": return 2 * t.length;
    case "p": return 2 * t.length + (t.decimals > 0 ? 1 : 0);
    case "d": return 8;
    case "t": return 6;
    case "i": return 11;
    case "int8": return 20;
    case "b": return 3;
    case "s": return 6;
    case "f": case "decfloat16": return 24;
    case "decfloat34": return 46;
    case "utclong": return 30;
    case "string": case "xstring": return undefined;
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
    // the size tells DDIC INT1 (b) and INT2 (s) from i
    switch (type.getBytes()) {
      case 1: return { kind: "b" };
      case 2: return { kind: "s" };
      default: return { kind: "i" };
    }
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
  throw new BuildError(`${name}: type ${type.toText(0)} is not supported yet, only elementary types`, where);
}

const SIMPLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A Source that is a literal, a variable or a subfield of a variable, perhaps in parentheses, or a build error. */
export function lowerSource(node: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where, what: string): IRSource {
  const source = unparenthesized(node);
  const constant = source.getChildren().length === 1 ? source.findDirectExpression(Expressions.Constant) : undefined;
  if (constant !== undefined) {
    return lowerConstant(constant, where);
  }
  const text = source.concatTokens();
  if (SIMPLE_NAME.test(text)) {
    return variables.find(text, source, where);
  }
  const chain = source.getChildren().length === 1 ? source.findDirectExpression(Expressions.FieldChain) : undefined;
  if (chain !== undefined) {
    const field = lowerFieldChain(chain, variables, where);
    if (field !== undefined) {
      return field;
    }
  }
  throw new BuildError(`${what} ${text}: only a literal, a variable or a subfield is supported yet`, where);
}

/**
 * A FieldChain that is a variable, with or without offset/length: the variable or its subfield; sy-index. undefined
 * for any other chain (components, other system fields, references, ...).
 */
export function lowerFieldChain(chain: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRVariable | IRSubstring | IRSystemField | undefined {
  if (/^sy-index$/i.test(chain.concatTokens())) {
    return { kind: "system_field", name: "index", type: { kind: "i" } };
  }
  const [field, ...rest] = chain.getChildren();
  if (!(field instanceof abaplint.Nodes.ExpressionNode) || !(field.get() instanceof Expressions.SourceField)
      || !SIMPLE_NAME.test(field.concatTokens()) || !rest.every(isOffsetOrLength)) {
    return undefined;
  }
  const base = variables.find(field.concatTokens(), field, where);
  return rest.length === 0 ? base : lowerSubstring(base, rest, variables, where);
}

function isOffsetOrLength(node: abaplint.Nodes.ExpressionNode | abaplint.Nodes.TokenNode): boolean {
  return node instanceof abaplint.Nodes.ExpressionNode
    && (node.get() instanceof Expressions.FieldOffset || node.get() instanceof Expressions.FieldLength);
}

/** A Target that is a variable or a subfield of a flat variable, or a build error. */
export function lowerTarget(target: abaplint.Nodes.ExpressionNode, variables: Variables, where: Where): IRTarget {
  const [field, ...rest] = target.getChildren();
  if (!(field instanceof abaplint.Nodes.ExpressionNode) || !(field.get() instanceof Expressions.TargetField)
      || !SIMPLE_NAME.test(field.concatTokens()) || !rest.every(isOffsetOrLength)) {
    throw new BuildError(`${target.concatTokens()}: only a variable or a subfield is supported as target yet`, where);
  }
  const base = variables.find(field.concatTokens(), field, where);
  return rest.length === 0 ? base : lowerSubstring(base, rest, variables, where);
}

/**
 * The subfield of base given by its FieldOffset and FieldLength nodes. A subfield of a utclong, a static length of 0
 * in a flat field and static bounds outside a c or x field are reported by abaplint, static bounds outside an n, d
 * or t field by layer 2 (src/check/substring.ts). Offset/length access to a numeric field that passes both is valid
 * ABAP and not compiled yet.
 */
function lowerSubstring(base: IRVariable, nodes: (abaplint.Nodes.ExpressionNode | abaplint.Nodes.TokenNode)[],
    variables: Variables, where: Where): IRSubstring {
  const offsetNode = nodes.find(n => n instanceof abaplint.Nodes.ExpressionNode && n.get() instanceof Expressions.FieldOffset);
  const lengthNode = nodes.find(n => n instanceof abaplint.Nodes.ExpressionNode && n.get() instanceof Expressions.FieldLength);
  const text = `${base.name}${nodes.map(n => n.concatTokens()).join("")}`;
  const size = flatLength(base.type);
  const flat = base.type.kind !== "string" && base.type.kind !== "xstring";
  if (flat && size === undefined) {
    throw new BuildError(`${text}: offset/length access to a field of type ${base.type.kind} is not compiled yet`, where);
  }

  // the offset or length: an integer or a variable
  const position = (node: abaplint.Nodes.ExpressionNode | abaplint.Nodes.TokenNode | undefined): IRLiteral | IRVariable | undefined => {
    if (node === undefined) {
      return undefined;
    }
    const value = (node as abaplint.Nodes.ExpressionNode).getChildren().filter(c => !["+", "(", ")"].includes(c.concatTokens()));
    const valueText = value.map(c => c.concatTokens()).join("");
    if (/^\d+$/.test(valueText)) {
      return { kind: "literal", type: { kind: "i" }, value: String(parseInt(valueText, 10)) };
    }
    if (value.length === 1 && value[0] instanceof abaplint.Nodes.ExpressionNode && SIMPLE_NAME.test(valueText)) {
      return variables.find(valueText, value[0], where);
    }
    throw new BuildError(`${text}: only an integer or a variable is supported as offset or length yet`, where);
  };
  const offset = position(offsetNode);
  const length = position(lengthNode);

  const staticOffset = offset === undefined ? 0 : offset.kind === "literal" ? parseInt(offset.value, 10) : undefined;
  const staticLength = length?.kind === "literal" ? parseInt(length.value, 10) : undefined;

  // only the rest of a field from a static offset has a length of its own that is known here
  const rest = size !== undefined && length === undefined && staticOffset !== undefined;
  const subLength = staticLength ?? (rest ? size - staticOffset : size);
  let type: IRType;
  switch (base.type.kind) {
    case "c": type = { kind: "c", length: subLength ?? 0 }; break;
    case "n": case "d": case "t": type = { kind: "n", length: subLength ?? 0 }; break;
    case "x": type = { kind: "x", length: subLength ?? 0 }; break;
    default: type = base.type;
  }
  return { kind: "substring", base, offset, length, type };
}

/** The length in characters or bytes of a flat type with subfields. */
function flatLength(t: IRType): number | undefined {
  switch (t.kind) {
    case "c": case "n": case "x": return t.length;
    case "d": return 8;
    case "t": return 6;
  }
  return undefined;
}

/**
 * A number literal: type i within its range, beyond it type p without decimals, of length 8 for up to 15 digits and
 * length 16 for up to 31. Leading zeros and the sign do not count. More than 31 digits are reported by layer 2
 * (src/check/literals.ts).
 */
export function integerLiteral(digits: string): IRLiteral {
  const value = BigInt(digits);
  if (value >= -(2n ** 31n) && value < 2n ** 31n) {
    return { kind: "literal", type: { kind: "i" }, value: value.toString() };
  }
  const count = (value < 0n ? -value : value).toString().length;
  return { kind: "literal", type: { kind: "p", length: count <= 15 ? 8 : 16, decimals: 0 }, value: value.toString() };
}

/** A Constant: a text field literal, a string literal (no & chains) or a number literal (i, or p beyond i). */
export function lowerConstant(constant: abaplint.Nodes.ExpressionNode, where: Where): IRLiteral {
  const text = constant.findDirectExpression(Expressions.ConstantString);
  if (text !== undefined && text.getChildren().length === 1) {
    const literal = textLiteral(text);
    return literal.type === "c"
      ? { kind: "literal", type: { kind: "c", length: literal.value.length }, value: literal.value } // UTF-16 code units
      : { kind: "literal", type: { kind: "string" }, value: literal.value };
  }
  const integer = constant.findDirectExpression(Expressions.Integer);
  if (integer !== undefined) {
    return integerLiteral(integer.concatTokens().replace(/\s+/g, ""));
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
  variables.declare(name, statement);
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

/**
 * target = source. with a variable as target and a literal, a variable or an arithmetic expression as source, and
 * target += -= *= /= source.
 */
export function lowerMove(statement: abaplint.Nodes.StatementNode, variables: Variables, where: Where): IRMove | IRCalculate {
  const targets = statement.findDirectExpressions(Expressions.Target);
  const sources = statement.findDirectExpressions(Expressions.Source);
  const children = statement.getChildren();
  const operator = children.slice(1, -2).map(c => c.concatTokens()).join("");
  if (targets.length !== 1 || sources.length !== 1 || targets[0].findDirectExpression(Expressions.InlineData) !== undefined
      || !["=", "+=", "-=", "*=", "/="].includes(operator)) {
    throw new BuildError(`${statement.concatTokens()}: only variable = literal, variable or arithmetic expression is supported yet`, where);
  }
  const variable = lowerTarget(targets[0], variables, where);
  if (operator !== "=") {
    return lowerCalculate(variable, operator[0] as "+" | "-" | "*" | "/", sources[0], variables, where);
  }
  if (isArithmetic(sources[0])) {
    return lowerCalculate(variable, undefined, sources[0], variables, where);
  }
  return {
    kind: "move",
    target: variable,
    source: lowerSource(sources[0], variables, where, "assignment of"),
  };
}
