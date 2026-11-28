// The types of data objects and operands, as far as the checks need them: abaplint types an expression during its
// syntax check but does not give the type out, so it is read from the declarations again.

import * as abaplint from "@abaplint/core";
import { CheckInput } from "./input";
import { builtInCall, isBitExpression, isNumericFunction, isStringExpression, parenthesized, returnType, word } from "./operand";

const { Expressions, BasicTypes, Nodes } = abaplint;

type ExpressionNode = abaplint.Nodes.ExpressionNode;
type Child = abaplint.Nodes.ExpressionNode | abaplint.Nodes.TokenNode;

/**
 * The type of an operand, undefined where it is not known here: attributes, dereferences, method calls, table
 * expressions and constructor expressions other than CONV and EXACT with a type name. A check reports nothing for an
 * unknown type. The type tells the kind only: the length of a result or of a subfield is not that of the operand.
 */
export function operandType(source: ExpressionNode, input: CheckInput): abaplint.AbstractType | undefined {
  const inner = parenthesized(source);
  if (inner !== undefined) {
    return operandType(inner, input);
  }
  const children = source.getChildren();
  const first = children[0];
  if (isBitExpression(source)) {
    return BasicTypes.XStringType.get();
  } else if (isStringExpression(source)) {
    return BasicTypes.StringType.get();
  } else if (["+", "-"].includes(word(first) ?? "") || children.some(c => c.get() instanceof Expressions.ArithOperator)) {
    return BasicTypes.IntegerType.get();
  }

  const keyword = word(first);
  if (keyword === "BOOLC") {
    return BasicTypes.StringType.get();
  } else if (keyword === "XSDBOOL") {
    return new BasicTypes.CharacterType(1);
  } else if (keyword === "CONV" || keyword === "EXACT") {
    const name = children[1];
    // CONV type( ... ) and nothing after it
    return children.length === 5 && name !== undefined ? namedType(name.concatTokens(), source, input) : undefined;
  }

  if (children.length !== 1 || !(first instanceof Nodes.ExpressionNode)) {
    return undefined;
  } else if (first.get() instanceof Expressions.Constant) {
    if (first.findDirectExpression(Expressions.Integer) !== undefined) {
      return BasicTypes.IntegerType.get();
    }
    return first.concatTokens().startsWith("`") ? BasicTypes.StringType.get() : new BasicTypes.CharacterType(1);
  } else if (first.get() instanceof Expressions.TextElement) {
    return new BasicTypes.CharacterType(1);
  } else if (first.get() instanceof Expressions.FieldChain) {
    return chainType(first.getChildren(), input);
  }
  const call = builtInCall(source, input);
  if (call === undefined) {
    return undefined;
  }
  // some numeric functions have the type of their argument: any numeric type will do
  return isNumericFunction(call) ? BasicTypes.IntegerType.get() : returnType(call);
}

/** The type of a data object: a field or field symbol, perhaps with components and with an offset or length. */
export function chainType(chain: readonly Child[], input: CheckInput): abaplint.AbstractType | undefined {
  const at = chain.findIndex(c => c.get() instanceof Expressions.FieldOffset || c.get() instanceof Expressions.FieldLength);
  const type = componentType(at < 0 ? chain : chain.slice(0, at), input);
  if (at < 0) {
    return type;
  } else if (type instanceof BasicTypes.DateType || type instanceof BasicTypes.TimeType) {
    // a subfield of a date or time is of type n
    return new BasicTypes.NumericType(1);
  }
  // a numeric field takes only an offset or length that covers the whole of it, i+0 or p(8)
  return [BasicTypes.CharacterType, BasicTypes.NumericType, BasicTypes.HexType, BasicTypes.StringType,
    BasicTypes.XStringType, BasicTypes.IntegerType, BasicTypes.Integer8Type, BasicTypes.PackedType,
    BasicTypes.FloatType, BasicTypes.DecFloat16Type, BasicTypes.DecFloat34Type].some(kind => type instanceof kind)
    ? type : undefined;
}

/**
 * The type of name or name-comp-...: a data object, perhaps with components; undefined for any other chain. The name
 * of a table with a header line is its header line.
 */
export function componentType(chain: readonly Child[], input: CheckInput): abaplint.AbstractType | undefined {
  const [field, ...rest] = chain;
  const names = [Expressions.SourceField, Expressions.TargetField, Expressions.SourceFieldSymbol,
    Expressions.TargetFieldSymbol];
  if (field === undefined || !names.some(kind => field.get() instanceof kind)) {
    return undefined;
  }
  let type = findVariable(field.getFirstToken(), input)?.getType();
  if (type instanceof BasicTypes.TableType && type.isWithHeader()) {
    type = type.getRowType();
  }
  for (let i = 0; i < rest.length; i += 2) {
    const component = rest[i + 1];
    if (rest[i].concatTokens() !== "-" || component === undefined || !(component.get() instanceof Expressions.ComponentName)
        || !(type instanceof BasicTypes.StructureType)) {
      return undefined;
    }
    type = type.getComponentByName(component.concatTokens());
  }
  return type;
}

export function findVariable(token: abaplint.Token, input: CheckInput): abaplint.TypedIdentifier | undefined {
  return input.spaghetti.lookupPosition(token.getStart(), input.file.getFilename())?.findVariable(token.getStr());
}

/** The type a type name stands for: a built-in type whose length does not matter here, or a type of the program. */
function namedType(name: string, node: ExpressionNode, input: CheckInput): abaplint.AbstractType | undefined {
  switch (name.toLowerCase()) {
    case "c": return new BasicTypes.CharacterType(1);
    case "n": return new BasicTypes.NumericType(1);
    case "d": return new BasicTypes.DateType();
    case "t": return new BasicTypes.TimeType();
    case "x": return new BasicTypes.HexType(1);
    case "string": return BasicTypes.StringType.get();
    case "xstring": return BasicTypes.XStringType.get();
    case "i": return BasicTypes.IntegerType.get();
    case "int8": return new BasicTypes.Integer8Type();
    case "p": return new BasicTypes.PackedType(8, 0);
    case "f": return new BasicTypes.FloatType();
    case "decfloat16": return new BasicTypes.DecFloat16Type();
    case "decfloat34": return new BasicTypes.DecFloat34Type();
    case "utclong": return new BasicTypes.UTCLongType();
  }
  const scope = input.spaghetti.lookupPosition(node.getFirstToken().getStart(), input.file.getFilename());
  return scope?.findType(name)?.getType();
}
