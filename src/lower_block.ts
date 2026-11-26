import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { IRCase, IRCondition, IRDo, IRStatement } from "./ir";
import { isArithmetic, lowerArithmetic } from "./lower_arith";
import { isNoop, lowerData, lowerMove, lowerSource, position, Variables, Where } from "./lower_common";
import { caseOperand, caseValue, lowerAssert, lowerCondition } from "./lower_cond";

const { Statements, Structures, Expressions } = abaplint;

type Node = abaplint.Nodes.StatementNode | abaplint.Nodes.StructureNode | abaplint.Nodes.TokenNode | abaplint.Nodes.ExpressionNode;

/**
 * Lowers the statements of one processing block, with control structures. leaf lowers what belongs to the kind of
 * root (WRITE, out->write( ), REPORT, ...): it returns undefined for a statement that does nothing.
 */
export class BlockLowerer {
  private loops = 0;
  /**
   * The blocks of the TRYs around the statement being lowered, innermost last, with the number of loops around each:
   * RETRY belongs in a CATCH block, and EXIT, CONTINUE and CHECK cannot leave a CLEANUP block.
   */
  private readonly handlers: { kind: "try" | "catch" | "cleanup"; loops: number }[] = [];

  constructor(private readonly file: abaplint.ABAPFile, private readonly variables: Variables,
      private readonly leaf: (statement: abaplint.Nodes.StatementNode, where: Where) => IRStatement | undefined) {}

  /** The statements and structures of nodes, in order. */
  lower(nodes: readonly Node[]): IRStatement[] {
    const out: IRStatement[] = [];
    for (const node of nodes) {
      if (node instanceof abaplint.Nodes.StatementNode) {
        const s = this.statement(node);
        if (s !== undefined) {
          out.push(s);
        }
      } else if (node instanceof abaplint.Nodes.StructureNode) {
        out.push(...this.structure(node));
      }
    }
    return out;
  }

  private structure(node: abaplint.Nodes.StructureNode): IRStatement[] {
    const kind = node.get();
    if (kind instanceof Structures.Any || kind instanceof Structures.Normal || kind instanceof Structures.Body) {
      return this.lower(node.getChildren());
    } else if (kind instanceof Structures.If) {
      return [this.lowerIf(node)];
    } else if (kind instanceof Structures.Case) {
      return [this.lowerCase(node)];
    } else if (kind instanceof Structures.Do) {
      return [this.lowerDo(node)];
    } else if (kind instanceof Structures.While) {
      return [this.lowerWhile(node)];
    } else if (kind instanceof Structures.Try) {
      return [this.lowerTry(node)];
    }
    throw new BuildError(`${kind.constructor.name} is not supported yet`, this.where(node));
  }

  private statement(statement: abaplint.Nodes.StatementNode): IRStatement | undefined {
    const where = this.where(statement);
    const kind = statement.get();
    if (isNoop(statement)) {
      return undefined;
    } else if (kind instanceof Statements.Data) {
      return lowerData(statement, this.variables, where);
    } else if (kind instanceof Statements.Move) {
      return lowerMove(statement, this.variables, where);
    } else if (kind instanceof Statements.Assert) {
      return lowerAssert(statement, this.variables, where);
    } else if (kind instanceof Statements.Exit || kind instanceof Statements.Continue || kind instanceof Statements.Check
        || kind instanceof Statements.Return) {
      return this.leaveStatement(statement, where);
    } else if (kind instanceof Statements.Retry) {
      // an ABAP syntax error that abaplint does not report yet (abaplint #4723)
      if (this.handlers[this.handlers.length - 1]?.kind !== "catch") {
        throw new BuildError("RETRY is only allowed in a CATCH block", where);
      }
      return { kind: "retry" };
    }
    return this.leaf(statement, where);
  }

  /**
   * RETURN, EXIT, CONTINUE and CHECK. In a loop, the last three refer to the innermost one. Outside a loop, EXIT and
   * CHECK leave the processing block, as RETURN does everywhere.
   */
  private leaveStatement(statement: abaplint.Nodes.StatementNode, where: Where): IRStatement {
    const kind = statement.get();
    const name = statement.getFirstToken().getStr().toUpperCase();
    const cleanup = this.handlers.filter(h => h.kind === "cleanup").pop();
    if (cleanup !== undefined && (kind instanceof Statements.Return || this.loops === cleanup.loops)) {
      throw new BuildError(`${name} cannot leave a CLEANUP block`, where);
    }
    if (kind instanceof Statements.Check) {
      const cond = statement.findDirectExpression(Expressions.Cond);
      if (cond === undefined) {
        throw new BuildError(`${statement.concatTokens()}: only CHECK <condition>. is supported yet`, where);
      }
      const leaves = this.loops === 0 ? "block" : "pass";
      return { kind: "check", condition: lowerCondition(cond, this.variables, where), leaves };
    }
    if (statement.getChildren().length !== 2) {
      throw new BuildError(`${statement.concatTokens()}: no additions are supported yet`, where);
    }
    if (kind instanceof Statements.Continue) {
      if (this.loops === 0) {
        throw new BuildError("CONTINUE is only possible in a loop", where);
      }
      return { kind: "continue" };
    }
    return kind instanceof Statements.Exit && this.loops > 0 ? { kind: "exit" } : { kind: "return" };
  }

  /** IF cond. ... [ELSEIF cond. ...]* [ELSE. ...] ENDIF. */
  private lowerIf(node: abaplint.Nodes.StructureNode): IRStatement {
    const first = node.findDirectStatement(Statements.If)!;
    const branches = [{ condition: this.condition(first), body: this.body(node) }];
    for (const elseIf of node.findDirectStructures(Structures.ElseIf)) {
      branches.push({ condition: this.condition(elseIf.findDirectStatement(Statements.ElseIf)!), body: this.body(elseIf) });
    }
    const otherwise = node.findDirectStructure(Structures.Else);
    return { kind: "if", branches, otherwise: otherwise === undefined ? undefined : this.body(otherwise) };
  }

  /** CASE operand. WHEN a [OR b ...]. ... [WHEN OTHERS. ...] ENDCASE. */
  private lowerCase(node: abaplint.Nodes.StructureNode): IRCase {
    const caseStatement = node.findDirectStatement(Statements.Case)!;
    const where = this.where(caseStatement);
    const operand = caseOperand(caseStatement.findDirectExpression(Expressions.Source)!, this.variables, where);
    if (node.findDirectStructures(Structures.Normal).some(n => n.findAllStatementNodes().some(s => !isNoop(s)))) {
      throw new BuildError("statements between CASE and the first WHEN are not supported", where);
    }
    const branches: IRCase["branches"] = [];
    let otherwise: IRStatement[] | undefined;
    for (const child of node.getChildren()) {
      if (child instanceof abaplint.Nodes.StatementNode && !isNoop(child) && !(child.get() instanceof Statements.Case)
          && !(child.get() instanceof Statements.EndCase)) {
        throw new BuildError(`${child.concatTokens()}: not supported in CASE`, this.where(child));
      }
      if (!(child instanceof abaplint.Nodes.StructureNode) || !(child.get() instanceof Structures.When)) {
        continue;
      }
      const whenStatement = child.findDirectStatement(Statements.When);
      if (whenStatement === undefined) { // WHEN OTHERS
        otherwise = this.body(child);
        continue;
      }
      const whereWhen = this.where(whenStatement);
      const values = [whenStatement.findDirectExpression(Expressions.Source)!,
        ...whenStatement.findDirectExpressions(Expressions.Or).map(o => o.findDirectExpression(Expressions.Source)!)];
      branches.push({
        values: values.map(v => caseValue(operand, v, this.variables, whereWhen)),
        body: this.body(child),
      });
    }
    if (otherwise === undefined && branches.length === 0) {
      throw new BuildError("CASE without WHEN: WHEN must be the first statement after CASE", where);
    }
    return { kind: "case", operand, branches, otherwise };
  }

  /** DO [n TIMES]. ... ENDDO. */
  private lowerDo(node: abaplint.Nodes.StructureNode): IRStatement {
    const statement = node.findDirectStatement(Statements.Do)!;
    const where = this.where(statement);
    const children = statement.getChildren();
    let times: IRDo["times"];
    if (children.length === 4 && children[2].concatTokens().toUpperCase() === "TIMES"
        && children[1] instanceof abaplint.Nodes.ExpressionNode && children[1].get() instanceof Expressions.Source) {
      times = isArithmetic(children[1])
        ? { kind: "into_i", expression: lowerArithmetic(children[1], this.variables, where) }
        : lowerSource(children[1], this.variables, where, "DO");
    } else if (children.length !== 2) {
      throw new BuildError(`${statement.concatTokens()}: only DO and DO n TIMES are supported yet, not VARYING`, where);
    }
    return { kind: "do", times, body: this.loopBody(node) };
  }

  /** WHILE cond. ... ENDWHILE. */
  private lowerWhile(node: abaplint.Nodes.StructureNode): IRStatement {
    const statement = node.findDirectStatement(Statements.While)!;
    if (statement.getChildren().length !== 3) {
      throw new BuildError(`${statement.concatTokens()}: VARY is not supported`, this.where(statement));
    }
    return { kind: "while", condition: this.condition(statement), body: this.loopBody(node) };
  }

  /** TRY. ... [CATCH cx ... . ...]* [CLEANUP. ...] ENDTRY. */
  private lowerTry(node: abaplint.Nodes.StructureNode): IRStatement {
    // an ABAP syntax error that abaplint does not report yet (abaplint #4724)
    if (node.findDirectStructure(Structures.Catch) === undefined && node.findDirectStructure(Structures.Cleanup) === undefined) {
      throw new BuildError("TRY needs a CATCH or a CLEANUP block", this.where(node));
    }
    const body = this.handlerBody("try", node);
    const catches = node.findDirectStructures(Structures.Catch).map(c => {
      const statement = c.findDirectStatement(Statements.Catch)!;
      const where = this.where(statement);
      if (statement.findDirectTokenByText("UNWIND") !== undefined) {
        throw new BuildError("CATCH BEFORE UNWIND is not supported yet", where);
      }
      if (statement.findDirectExpression(Expressions.Target) !== undefined) {
        throw new BuildError("CATCH ... INTO is not supported yet: object references are not compiled", where);
      }
      const classes = new Set<string>();
      for (const name of statement.findDirectExpressions(Expressions.ClassName)) {
        catchClasses(this.variables.registry, name.concatTokens(), where).forEach(c => classes.add(c));
      }
      return { classes: [...classes].sort(), body: this.handlerBody("catch", c) };
    });
    const cleanupNode = node.findDirectStructure(Structures.Cleanup);
    let cleanup: IRStatement[] | undefined;
    if (cleanupNode !== undefined) {
      const statement = cleanupNode.findDirectStatement(Statements.Cleanup)!;
      if (statement.findDirectExpression(Expressions.Target) !== undefined) {
        throw new BuildError("CLEANUP INTO is not supported yet: object references are not compiled", this.where(statement));
      }
      cleanup = this.handlerBody("cleanup", cleanupNode);
    }
    return { kind: "try", body, catches, cleanup };
  }

  private handlerBody(kind: "try" | "catch" | "cleanup", node: abaplint.Nodes.StructureNode): IRStatement[] {
    this.handlers.push({ kind, loops: this.loops });
    try {
      return this.body(node);
    } finally {
      this.handlers.pop();
    }
  }

  private loopBody(node: abaplint.Nodes.StructureNode): IRStatement[] {
    this.loops++;
    try {
      return this.body(node);
    } finally {
      this.loops--;
    }
  }

  /** The Body directly below node, or nothing. */
  private body(node: abaplint.Nodes.StructureNode): IRStatement[] {
    const body = node.findDirectStructure(Structures.Body);
    return body === undefined ? [] : this.lower(body.getChildren());
  }

  private condition(statement: abaplint.Nodes.StatementNode): IRCondition {
    return lowerCondition(statement.findDirectExpression(Expressions.Cond)!, this.variables, this.where(statement));
  }

  private where(node: abaplint.Nodes.StatementNode | abaplint.Nodes.StructureNode): Where {
    const statement = node instanceof abaplint.Nodes.StatementNode ? node : node.getFirstStatement()!;
    return position(this.file, statement);
  }
}

/**
 * The global classes a CATCH of name catches: the class and all its subclasses in the world, upper case. The
 * runtime raises exceptions by the name of their class, so a CATCH clause is the set of names it matches. name must
 * be a global class derived from CX_ROOT; the exception classes the runtime raises are in the built-in library.
 * Anything else is an ABAP syntax error that abaplint does not report yet (abaplint #4725).
 */
function catchClasses(registry: abaplint.IRegistry, name: string, where: Where): string[] {
  const upper = name.toUpperCase();
  const parents = new Map<string, string | undefined>();
  for (const obj of registry.getObjects()) {
    if (obj instanceof abaplint.Objects.Class) {
      parents.set(obj.getName().toUpperCase(), obj.getClassDefinition()?.superClassName?.toUpperCase());
    }
  }
  if (!parents.has(upper)) {
    throw new BuildError(registry.getObject("INTF", upper) !== undefined
      ? `CATCH ${name}: ${upper} is an interface, not a class derived from CX_ROOT`
      : `CATCH ${name}: only global exception classes are supported yet`, where);
  }
  const ancestors = (c: string): string[] => {
    const out: string[] = [];
    for (let p: string | undefined = c; p !== undefined && !out.includes(p); p = parents.get(p)) {
      out.push(p);
    }
    return out;
  };
  if (!ancestors(upper).includes("CX_ROOT")) {
    throw new BuildError(`CATCH ${name}: ${upper} is not derived from CX_ROOT`, where);
  }
  return [...parents.keys()].filter(c => ancestors(c).includes(upper));
}
