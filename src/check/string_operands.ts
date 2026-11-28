import * as abaplint from "@abaplint/core";
import { CheckInput, issueAt } from "./input";
import { characterLength, isByteLike, isCharacterLike, structureLayout } from "./layout";
import { staticValue } from "./substring";
import { chainType, componentType, findVariable, operandType } from "./types";

const { Expressions, Statements, BasicTypes, Nodes } = abaplint;

type ExpressionNode = abaplint.Nodes.ExpressionNode;
type StatementNode = abaplint.Nodes.StatementNode;

/** An operand of a statement with the keyword before it, "" if it follows another operand. */
interface Operand {
  readonly node: ExpressionNode;
  readonly after: string;
}

/** character-like; character-like and flat, so no string; byte-like */
type Kind = "character" | "flat" | "byte";

/**
 * The operands of the statements on character and byte strings, which a Unicode program is expected to take only if
 * they are character-like (c, n, d, t, string or a flat structure of c, n, d and t) or, in byte mode, byte-like
 * (x, xstring): CONDENSE, TRANSLATE, SPLIT, CONCATENATE, OVERLAY, SHIFT, SEARCH, FIND, REPLACE ... IN BYTE MODE,
 * CLEAR ... WITH, SET BIT and GET BIT. UNPACK and DESCRIBE FIELD ... LENGTH IN CHARACTER MODE take no string either.
 * The value of CLEAR ... WITH has the length 1 if its length is fixed.
 */
export function stringOperands(input: CheckInput): abaplint.Issue[] {
  const issues: abaplint.Issue[] = [];
  for (const statement of input.file.getStatements()) {
    for (const [operand, kind] of requirements(statement)) {
      const search = statement.get() instanceof Statements.Search && operand.after === "SEARCH";
      const type = (search ? rowType(operand.node, input) : undefined) ?? typeOf(operand.node, input);
      if (type === undefined) {
        continue;
      }
      const fits = kind === "byte" ? isByteLike(type) : isCharacterLike(type, kind === "flat");
      const name = `"${operand.node.concatTokens()}"`;
      const token = operand.node.getFirstToken();
      if (fits === false) {
        const expected = kind === "byte" ? "byte-like (type x or xstring)"
          : `character-like (type c, n, d${kind === "flat" ? " or t" : ", t or string"})`;
        issues.push(issueAt(input, token, `${name} must be ${expected}`, "operand_kind"));
      } else if (statement.get() instanceof Statements.Clear && operand.after === "WITH") {
        const length = fixedLength(operand.node, type, input);
        if (length !== undefined && length !== 1) {
          issues.push(issueAt(input, token, `${name} must have the length 1`, "clear_value_length"));
        }
      }
    }
  }
  return issues;
}

/** The operands of the statement that need a kind of type. */
function requirements(statement: StatementNode): [Operand, Kind][] {
  const words: string[] = [];
  const operands: Operand[] = [];
  let after = "";
  for (const child of statement.getChildren()) {
    if (child instanceof Nodes.TokenNode) {
      after = child.getFirstToken().getStr().toUpperCase();
      words.push(after);
    } else if (child instanceof Nodes.ExpressionNode) {
      if (child.get() instanceof Expressions.Source || child.get() instanceof Expressions.Target
          || child.get() instanceof Expressions.SimpleSource3) {
        operands.push({ node: child, after });
      }
      after = "";
    }
  }
  const byte = words.some((w, i) => w === "BYTE" && words[i + 1] === "MODE");
  const mode: Kind = byte ? "byte" : "character";
  const all = (list: readonly (Operand | undefined)[], kind: Kind): [Operand, Kind][] =>
    list.filter((o): o is Operand => o !== undefined).map(o => [o, kind]);
  const sources = operands.filter(o => !(o.node.get() instanceof Expressions.Target));
  const kind = statement.get();

  if (kind instanceof Statements.Condense || kind instanceof Statements.Translate || kind instanceof Statements.Overlay) {
    return all(operands, mode);
  } else if (kind instanceof Statements.Split) {
    // the targets are abaplint's, which also tells a table from a field
    return all(sources, mode);
  } else if (kind instanceof Statements.Concatenate) {
    // the operand of LINES OF is a table
    return all(words.includes("LINES") ? operands.filter(o => o.after !== "OF") : operands, mode);
  } else if (kind instanceof Statements.Shift) {
    // not the number of places
    return all(operands.filter((o, i) => i === 0 || ["TO", "LEADING", "TRAILING"].includes(o.after)), mode);
  } else if (kind instanceof Statements.Search) {
    return all(operands.filter((o, i) => i === 0 || o.after === "FOR"), "character");
  } else if (kind instanceof Statements.Find) {
    if (words.includes("TABLE")) {
      return [];
    }
    // a regular expression may be an object
    const regex = statement.findDirectExpression(Expressions.FindType)?.concatTokens().toUpperCase();
    const pattern = regex === "REGEX" || regex === "PCRE" ? undefined : operands[0];
    const preposition = words.includes("SECTION") ? "OF" : "IN";
    return all([pattern, operands.slice(1).find(o => o.after === preposition)], mode);
  } else if (kind instanceof Statements.Replace) {
    // character mode is abaplint's. The text to change is a target after IN, as the counts and offsets of the results
    // are targets after other words
    return byte && !words.includes("TABLE") && !words.includes("SECTION")
      ? all(operands.filter(o => sources.includes(o) || o.after === "IN"), "byte") : [];
  } else if (kind instanceof Statements.Clear) {
    return words.includes("WITH") ? all(operands, mode) : [];
  } else if (kind instanceof Statements.Describe) {
    return words.includes("FIELD") && words.includes("CHARACTER")
      ? all(operands.filter(o => o.after === "FIELD"), "flat") : [];
  } else if (kind instanceof Statements.Unpack) {
    return all(operands.filter(o => o.after === "TO"), "flat");
  } else if (kind instanceof Statements.SetBit || kind instanceof Statements.GetBit) {
    return all(operands.filter(o => o.after === "OF"), "byte");
  }
  return [];
}

/**
 * The row type if the operand is the name of a table, which SEARCH reads as the table, header line or not: its rows
 * are searched.
 */
function rowType(node: ExpressionNode, input: CheckInput): abaplint.AbstractType | undefined {
  const type = /^[\w/]+(\[\])?$/.test(node.concatTokens())
    ? findVariable(node.getFirstToken(), input)?.getType() : undefined;
  return type instanceof BasicTypes.TableType ? type.getRowType() : undefined;
}

function typeOf(node: ExpressionNode, input: CheckInput): abaplint.AbstractType | undefined {
  if (node.get() instanceof Expressions.Target) {
    return chainType(node.getChildren(), input);
  } else if (node.get() instanceof Expressions.SimpleSource3) {
    const chain = node.findDirectExpression(Expressions.FieldChain);
    return chain === undefined ? operandType(node, input) : chainType(chain.getChildren(), input);
  }
  return operandType(node, input);
}

/**
 * The length of an operand where the source code fixes it: a text literal, or a data object of a type with a length,
 * perhaps with a static offset or length. Undefined for a string, a text symbol, a variable offset or length and
 * anything else.
 */
function fixedLength(node: ExpressionNode, type: abaplint.AbstractType, input: CheckInput): number | undefined {
  const [first, ...more] = node.getChildren();
  if (more.length > 0 || !(first instanceof Nodes.ExpressionNode)
      || type instanceof BasicTypes.StringType || type instanceof BasicTypes.XStringType) {
    return undefined;
  } else if (first.get() instanceof Expressions.Constant) {
    const text = first.concatTokens();
    // '' has the length 1
    return /^'.*'$/.test(text) ? Math.max(text.slice(1, -1).replace(/''/g, "'").length, 1) : undefined;
  } else if (!(first.get() instanceof Expressions.FieldChain)) {
    return undefined;
  }
  const chain = first.getChildren();
  const part = (kind: typeof Expressions.FieldOffset | typeof Expressions.FieldLength) =>
    chain.find(c => c.get() instanceof kind) as ExpressionNode | undefined;
  const length = part(Expressions.FieldLength);
  if (length !== undefined && !length.concatTokens().includes("*")) {
    return staticValue(length, input);
  }
  const at = chain.findIndex(c => c.get() instanceof Expressions.FieldOffset || c.get() instanceof Expressions.FieldLength);
  const whole = componentType(at < 0 ? chain : chain.slice(0, at), input);
  if (whole === undefined) {
    return undefined;
  }
  const full = whole instanceof BasicTypes.HexType ? whole.getLength()
    : whole instanceof BasicTypes.StructureType ? structureLayout(whole)?.length : characterLength(whole);
  const offset = part(Expressions.FieldOffset);
  const skipped = offset === undefined ? 0 : staticValue(offset, input);
  return full === undefined || skipped === undefined ? undefined : full - skipped;
}
