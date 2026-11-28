import * as abaplint from "@abaplint/core";
import { conversionRaises, SourceLiteral } from "./convertible";
import { CheckInput, issueAt } from "./input";
import { findVariable } from "./types";

const { Expressions, Statements, BasicTypes } = abaplint;

type StatementNode = abaplint.Nodes.StatementNode;
type ExpressionNode = abaplint.Nodes.ExpressionNode;

/**
 * The literal of a VALUE addition must convert to the type of its data object: a conversion that would raise an
 * exception is a syntax error. The same literal in a move is valid and raises when it runs. A constant named after
 * VALUE is not checked here.
 */
export function valueLiteral(input: CheckInput): abaplint.Issue[] {
  const issues: abaplint.Issue[] = [];
  // the BEGIN OF statements around the current one, outermost first
  const structures: StatementNode[] = [];
  for (const statement of input.file.getStatements()) {
    const kind = statement.get();
    if (kind instanceof Statements.DataBegin || kind instanceof Statements.ConstantBegin
        || kind instanceof Statements.ClassDataBegin || kind instanceof Statements.StaticBegin) {
      structures.push(statement);
    } else if (kind instanceof Statements.DataEnd || kind instanceof Statements.ConstantEnd
        || kind instanceof Statements.ClassDataEnd || kind instanceof Statements.StaticEnd) {
      structures.pop();
    } else if (kind instanceof Statements.Data || kind instanceof Statements.Constant
        || kind instanceof Statements.ClassData || kind instanceof Statements.Static) {
      const constant = statement.findFirstExpression(Expressions.Value)?.findDirectExpression(Expressions.Constant);
      const source = constant === undefined ? undefined : literal(constant);
      const name = statement.findFirstExpression(Expressions.DefinitionName);
      if (constant === undefined || source === undefined || name === undefined) {
        continue;
      }
      const type = declaredType(name, structures, input);
      if (type !== undefined && conversionRaises(source, type)) {
        issues.push(issueAt(input, constant.getFirstToken(),
          `the VALUE ${constant.concatTokens()} cannot be converted to the type of ${name.concatTokens()}`,
          "value_literal"));
      }
    }
  }
  return issues;
}

/** A literal, its parts joined if it is written with &. */
function literal(constant: ExpressionNode): SourceLiteral | undefined {
  const number = constant.findDirectExpression(Expressions.Integer);
  if (number !== undefined) {
    const value = number.concatTokens().replace(/\s+/g, "");
    // a number of more than 31 digits is no literal at all (numberLiteralLength)
    return value.replace(/^-/, "").length > 31 ? undefined : { kind: "number", value };
  }
  const parts = constant.getAllTokens().map(t => t.getStr()).filter(t => t !== "&");
  const quote = parts[0]?.[0];
  if ((quote !== "'" && quote !== "`") || !parts.every(p => p.startsWith(quote) && p.endsWith(quote))) {
    return undefined; // a text symbol, which abaplint's grammar allows here
  }
  const value = parts.map(p => p.slice(1, -1).split(quote + quote).join(quote)).join("");
  return { kind: quote === "'" ? "c" : "string", value };
}

/** The type of the declared data object, a component if the declaration is inside BEGIN OF. */
function declaredType(name: ExpressionNode, structures: readonly StatementNode[],
    input: CheckInput): abaplint.AbstractType | undefined {
  // the name is the first expression of a BEGIN OF statement, whose kind differs between the statements
  const names = structures.map(s => s.getChildren().find(c => c instanceof abaplint.Nodes.ExpressionNode));
  const [outermost, ...inner] = [...names, name];
  if (outermost === undefined) {
    return undefined;
  }
  let type = findVariable(outermost.getFirstToken(), input)?.getType();
  for (const component of inner) {
    // BEGIN OF ... OCCURS declares a table of the structure
    if (type instanceof BasicTypes.TableType) {
      type = type.getRowType();
    }
    if (component === undefined || !(type instanceof BasicTypes.StructureType)) {
      return undefined;
    }
    type = type.getComponentByName(component.concatTokens());
  }
  return type;
}
