import * as abaplint from "@abaplint/core";
import { CheckInput, issueAt } from "./input";

const { Statements, Nodes } = abaplint;

type StatementNode = abaplint.Nodes.StatementNode;

/**
 * The additions a Unicode program is expected to require, which abaplint takes as optional, as a program that is not
 * Unicode may leave them out: IN ... MODE of DESCRIBE FIELD ... LENGTH and DESCRIBE DISTANCE; FOR ... and IN ... MODE
 * of OPEN DATASET, and the ENCODING of its TEXT MODE. One finding per statement, for the first one missing.
 */
export function unicodeAdditions(input: CheckInput): abaplint.Issue[] {
  const issues: abaplint.Issue[] = [];
  for (const statement of input.file.getStatements()) {
    const message = missing(statement);
    if (message !== undefined) {
      issues.push(issueAt(input, statement.getFirstToken(), message, "unicode_addition"));
    }
  }
  return issues;
}

function missing(statement: StatementNode): string | undefined {
  // the keywords of the statement itself, "" in the place of an operand
  const words = statement.getChildren()
    .map(c => c instanceof Nodes.TokenNode ? c.getFirstToken().getStr().toUpperCase() : "");
  const has = (word: string) => words.includes(word);
  if (statement.get() instanceof Statements.Describe) {
    // OUTPUT-LENGTH is three tokens, and needs no mode
    const length = words.some((w, i) => w === "LENGTH" && words[i - 1] !== "-");
    if (has("FIELD") && length && !has("MODE")) {
      return "DESCRIBE FIELD ... LENGTH needs IN BYTE MODE or IN CHARACTER MODE";
    } else if (has("DISTANCE") && !has("MODE")) {
      return "DESCRIBE DISTANCE needs IN BYTE MODE or IN CHARACTER MODE";
    }
  } else if (statement.get() instanceof Statements.OpenDataset) {
    if (!has("FOR")) {
      return "OPEN DATASET needs FOR INPUT, OUTPUT, APPENDING or UPDATE";
    } else if (!has("MODE")) {
      return "OPEN DATASET needs IN ... MODE";
    } else if (has("TEXT") && !has("LEGACY") && !has("ENCODING")) {
      return "OPEN DATASET ... IN TEXT MODE needs ENCODING";
    }
  }
  return undefined;
}
