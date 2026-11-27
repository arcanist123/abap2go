import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { IRReport, IRStatement } from "./ir";
import { BlockLowerer } from "./lower_block";
import { lowerSource, Variables, Where } from "./lower_common";

const { Statements, Expressions } = abaplint;

/** Lowers an executable program. Only START-OF-SELECTION is supported, explicit or implicit, in one or more blocks. */
export function lowerReport(registry: abaplint.IRegistry, obj: abaplint.Objects.Program): IRReport {
  const subc = /<SUBC>([^<]*)<\/SUBC>/.exec(obj.getXML() ?? "")?.[1];
  if (subc !== "1") {
    throw new BuildError(`root ${obj.getName()}: only executable programs (SUBC 1) can be roots, this one has SUBC ${subc ?? "unknown"}`);
  }
  const files = obj.getABAPFiles();
  if (files.length !== 1) {
    throw new BuildError(`root ${obj.getName()}: expected one source file, found ${files.length}`);
  }
  const file = files[0];
  const variables = new Variables(registry, obj, file);

  let lineSize: number | undefined;
  const structure = file.getStructure();
  if (structure === undefined) {
    throw new BuildError(`root ${obj.getName()}: the program does not parse`);
  }
  const lowerer = new BlockLowerer(file, variables, "program", (statement, where) => {
    const kind = statement.get();
    if (kind instanceof Statements.Report) {
      lineSize = lowerReportStatement(statement, where);
      return undefined;
    } else if (kind instanceof Statements.Write) {
      return lowerWrite(statement, variables, where);
    }
    throw new BuildError(`statement ${kind.constructor.name} is not supported yet`, where);
  });
  // each START-OF-SELECTION starts a block; the statements before the first one are a block of their own
  const blocks: IRStatement[][] = [];
  let nodes: (abaplint.Nodes.StatementNode | abaplint.Nodes.StructureNode)[] = [];
  for (const node of structure.getChildren()) {
    if (node instanceof abaplint.Nodes.StatementNode && node.get() instanceof Statements.StartOfSelection) {
      blocks.push(lowerer.lower(nodes));
      nodes = [];
    } else {
      nodes.push(node as abaplint.Nodes.StatementNode | abaplint.Nodes.StructureNode);
    }
  }
  blocks.push(lowerer.lower(nodes));
  return { kind: "report", name: obj.getName(), lineSize, blocks };
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

/** WRITE [/] of a literal, a variable, a subfield or sy-index. */
function lowerWrite(statement: abaplint.Nodes.StatementNode, variables: Variables, where: Where): IRStatement {
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
  // WRITE ( x ) is not taken as WRITE x: it is not compiled
  if (!(source instanceof abaplint.Nodes.ExpressionNode) || !(source.get() instanceof Expressions.Source) || index + 2 !== children.length
      || source.getFirstToken().getStr() === "(") {
    throw new BuildError("only WRITE [/] <literal or variable>. is supported yet, no additions", where);
  }
  const value = lowerSource(source, variables, where, "WRITE of");
  // sy-index needs no check: its data element, SYST_INDEX, is expected to have the output length of its type i
  // and no conversion exit
  if (value.kind === "variable") {
    variables.checkWriteFormat(value, where);
  }
  return { kind: "list_write", newLine, value };
}
