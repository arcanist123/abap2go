import * as abaplint from "@abaplint/core";
import { CheckInput, expressions, issueAt } from "./input";
import { componentType, findVariable } from "./types";

const { Expressions, BasicTypes } = abaplint;

/**
 * Static bounds outside a field of type n, d or t, as abaplint reports them for c and x: with a static offset and no
 * length, the offset must lie inside the field; with a static length, the offset (0 if none) and the length must.
 * A variable offset or length leaves the bounds to the run time; a constant counts as static. Only a data object
 * named directly or a component of a structure is checked here, not a field symbol, reference or attribute.
 */
export function substringBounds(input: CheckInput): abaplint.Issue[] {
  const issues: abaplint.Issue[] = [];
  for (const node of expressions(input.file)) {
    const children = node.getChildren();
    const at = children.findIndex(isOffsetOrLength);
    if (at <= 0) {
      continue;
    }
    const size = fieldLength(componentType(children.slice(0, at), input));
    if (size === undefined || children[0].get() instanceof Expressions.SourceFieldSymbol) {
      continue;
    }
    const offsetNode = children.find(c => c.get() instanceof Expressions.FieldOffset);
    const lengthNode = children.find(c => c.get() instanceof Expressions.FieldLength);
    const offset = offsetNode === undefined ? 0 : staticValue(offsetNode as abaplint.Nodes.ExpressionNode, input);
    const length = lengthNode === undefined ? undefined : staticValue(lengthNode as abaplint.Nodes.ExpressionNode, input);
    if (offset === undefined || (lengthNode !== undefined && length === undefined)) {
      continue;
    }
    const first = children[at].getFirstToken();
    if (length === undefined && offset >= size) {
      issues.push(issueAt(input, first, `the offset ${offset} is not within the length ${size}`, "substring_bounds"));
    } else if (length !== undefined && offset + length > size) {
      issues.push(issueAt(input, first, `the offset ${offset} and length ${length} exceed the length ${size}`, "substring_bounds"));
    }
  }
  return issues;
}

function isOffsetOrLength(node: abaplint.INode): boolean {
  return node.get() instanceof Expressions.FieldOffset || node.get() instanceof Expressions.FieldLength;
}

/** The length of a field of type n, d or t, undefined for any other type. */
function fieldLength(type: abaplint.AbstractType | undefined): number | undefined {
  if (type instanceof BasicTypes.NumericType) {
    return type.getLength();
  } else if (type instanceof BasicTypes.DateType) {
    return 8;
  } else if (type instanceof BasicTypes.TimeType) {
    return 6;
  }
  return undefined;
}

/** The offset or length as a number if it is an integer or a constant of integer value, else undefined. */
export function staticValue(node: abaplint.Nodes.ExpressionNode, input: CheckInput): number | undefined {
  const value = node.getChildren().filter(c => !["+", "(", ")"].includes(c.concatTokens()));
  if (value.length !== 1) {
    return undefined;
  }
  const text = value[0].concatTokens();
  if (/^\d+$/.test(text)) {
    return parseInt(text, 10);
  }
  const chain = value[0] instanceof abaplint.Nodes.ExpressionNode ? value[0].getChildren() : [];
  if (!(value[0].get() instanceof Expressions.SimpleFieldChain2) || chain.length !== 1) {
    return undefined;
  }
  const constant = findVariable(chain[0].getFirstToken(), input);
  const meta = constant?.getMeta() ?? [];
  const constValue = constant?.getValue();
  if (!meta.includes(abaplint.IdentifierMeta.ReadOnly) || !meta.includes(abaplint.IdentifierMeta.Static)
      || typeof constValue !== "string" || !/^\d+$/.test(constValue)) {
    return undefined;
  }
  return parseInt(constValue, 10);
}
