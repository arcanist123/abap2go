import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";

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

/** The literal a Source consists of, or a build error naming what it is instead. */
export function sourceLiteral(source: abaplint.Nodes.ExpressionNode, where: Where, what: string): Literal {
  const literal = source.getChildren().length === 1
    ? source.findDirectExpression(abaplint.Expressions.Constant)?.findDirectExpression(abaplint.Expressions.ConstantString)
    : undefined;
  if (literal === undefined || literal.getChildren().length !== 1) {
    throw new BuildError(`${what} ${source.concatTokens()}: only a literal is supported yet`, where);
  }
  const raw = literal.getFirstToken().getStr();
  const quote = raw[0];
  const value = raw.slice(1, -1).split(quote + quote).join(quote);
  if (quote === "'") {
    return { type: "c", value: value === "" ? " " : value };
  }
  return { type: "string", value };
}

/** The conversion of a literal to type string: a text field loses its trailing blanks. */
export function literalToString(literal: Literal): string {
  return literal.type === "c" ? literal.value.replace(/ +$/, "") : literal.value;
}
