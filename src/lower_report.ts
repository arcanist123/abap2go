import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { IRReport, IRStatement } from "./ir";
import { isNoop, position, sourceLiteral, Where } from "./lower_common";

const { Statements, Expressions } = abaplint;

/** Lowers an executable program. Only START-OF-SELECTION is supported, explicit or implicit. */
export function lowerReport(obj: abaplint.Objects.Program): IRReport {
  const subc = /<SUBC>([^<]*)<\/SUBC>/.exec(obj.getXML() ?? "")?.[1];
  if (subc !== "1") {
    throw new BuildError(`root ${obj.getName()}: only executable programs (SUBC 1) can be roots, this one has SUBC ${subc ?? "unknown"}`);
  }
  const files = obj.getABAPFiles();
  if (files.length !== 1) {
    throw new BuildError(`root ${obj.getName()}: expected one source file, found ${files.length}`);
  }
  const file = files[0];

  let lineSize: number | undefined;
  const body: IRStatement[] = [];
  for (const statement of file.getStatements()) {
    const where = position(file, statement);
    const kind = statement.get();
    if (isNoop(statement) || kind instanceof Statements.StartOfSelection) {
      continue;
    } else if (kind instanceof Statements.Report) {
      lineSize = lowerReportStatement(statement, where);
    } else if (kind instanceof Statements.Write) {
      body.push(lowerWrite(statement, where));
    } else {
      throw new BuildError(`statement ${kind.constructor.name} is not supported yet`, where);
    }
  }
  return { kind: "report", name: obj.getName(), lineSize, body };
}

/** REPORT: returns LINE-SIZE if given. */
function lowerReportStatement(statement: abaplint.Nodes.StatementNode, where: Where): number | undefined {
  // The additions after REPORT <name>. abaplint splits LINE-SIZE into three tokens, so match on the joined text.
  let rest = statement.concatTokens().toUpperCase().replace(/^REPORT\s+\S+/, "").replace(/\.$/, "").trim();
  let lineSize: number | undefined;
  while (rest !== "") {
    let m: RegExpExecArray | null;
    if ((m = /^NO\s+STANDARD\s+PAGE\s+HEADING\b/.exec(rest)) !== null) {
      // The standard page header is not written to the text list (as in open-abap-gui's list processor), so this
      // only matters once TOP-OF-PAGE is supported.
    } else if ((m = /^LINE-SIZE\s+(\d+)\b/.exec(rest)) !== null) {
      lineSize = parseInt(m[1], 10);
    } else {
      throw new BuildError(`REPORT addition ${rest.split(/\s+/)[0]} is not supported yet`, where);
    }
    rest = rest.slice(m[0].length).trim();
  }
  return lineSize;
}

/** WRITE [/] literal. */
function lowerWrite(statement: abaplint.Nodes.StatementNode, where: Where): IRStatement {
  const children = statement.getChildren();
  let index = 1; // after WRITE
  let newLine = false;

  const offsetLength = statement.findDirectExpression(Expressions.WriteOffsetLength);
  if (offsetLength !== undefined) {
    if (offsetLength.concatTokens() !== "/") {
      throw new BuildError(`WRITE position ${offsetLength.concatTokens()} is not supported yet`, where);
    }
    newLine = true;
    index++;
  }

  const source = children[index];
  if (!(source instanceof abaplint.Nodes.ExpressionNode) || !(source.get() instanceof Expressions.Source) || index + 2 !== children.length) {
    throw new BuildError("only WRITE [/] <literal>. is supported yet, no additions", where);
  }
  const literal = sourceLiteral(source, where, "WRITE of");
  if (literal.type === "c" && literal.value.endsWith(" ")) {
    // WRITE outputs a text field with its full length, and the gap counts from there. open-steamgate converts the
    // operand to a string first, which drops the blanks; SAP's result is not measured yet.
    throw new BuildError("WRITE of a text field literal ending in blanks (or '') is not supported yet", where);
  }
  return { kind: "list_write", newLine, text: literal.value };
}
