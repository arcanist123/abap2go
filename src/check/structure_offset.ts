import * as abaplint from "@abaplint/core";
import { CheckInput, expressions, issueAt } from "./input";
import { Layout, structureLayout } from "./layout";
import { staticValue } from "./substring";
import { componentType } from "./types";

const { Expressions, BasicTypes } = abaplint;

type ExpressionNode = abaplint.Nodes.ExpressionNode;

/**
 * An offset or length on a structure, which a Unicode program is expected to allow only on a flat structure and only
 * within its character-like initial part; without a length, or with (*), the access reaches to the end of the
 * structure, which must then be character-like throughout. A variable offset or length leaves its bound to the run
 * time; a constant counts as static.
 */
export function structureOffsets(input: CheckInput): abaplint.Issue[] {
  const issues: abaplint.Issue[] = [];
  for (const node of expressions(input.file)) {
    const children = node.getChildren();
    const at = children.findIndex(c => c.get() instanceof Expressions.FieldOffset || c.get() instanceof Expressions.FieldLength);
    if (at <= 0) {
      continue;
    }
    const type = componentType(children.slice(0, at), input);
    const layout = type instanceof BasicTypes.StructureType ? structureLayout(type) : undefined;
    if (layout === undefined) {
      continue;
    }
    const part = (kind: typeof Expressions.FieldOffset | typeof Expressions.FieldLength) =>
      children.find(c => c.get() instanceof kind) as ExpressionNode | undefined;
    const message = bounds(layout, part(Expressions.FieldOffset), part(Expressions.FieldLength), input);
    if (message !== undefined) {
      issues.push(issueAt(input, children[at].getFirstToken(), message, "structure_offset"));
    }
  }
  return issues;
}

function bounds(layout: Layout, offsetNode: ExpressionNode | undefined, lengthNode: ExpressionNode | undefined,
    input: CheckInput): string | undefined {
  const max = layout.characters;
  if (layout.deep) {
    return "A deep structure cannot be accessed with an offset or length";
  } else if (max === 0) {
    return "A structure without a character-like initial part cannot be accessed with an offset or length";
  }
  // undefined: variable
  const offset = offsetNode === undefined ? 0 : staticValue(offsetNode, input);
  const rest = lengthNode === undefined || lengthNode.concatTokens().includes("*");
  const length = rest ? undefined : staticValue(lengthNode, input);

  if (offset !== undefined && offset >= max) {
    return `the offset ${offset} is not within the character-like initial part of length ${max}`;
  } else if (length !== undefined && (offset ?? 0) + length > max) {
    return `the offset and length exceed the character-like initial part of length ${max}`;
  } else if (rest && offset !== undefined && layout.length === undefined) {
    return `the access to the end of the structure exceeds its character-like initial part of length ${max}`;
  }
  return undefined;
}
