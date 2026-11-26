import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { IRCondition, IRSource, IRStatement } from "./ir";
import { isArithmetic } from "./lower_arith";
import { isNoop, lowerData, lowerMove, lowerSource, position, Variables, Where } from "./lower_common";
import { lowerAssert, lowerComparison, lowerCondition } from "./lower_cond";

const { Statements, Structures, Expressions } = abaplint;

type Node = abaplint.Nodes.StatementNode | abaplint.Nodes.StructureNode | abaplint.Nodes.TokenNode | abaplint.Nodes.ExpressionNode;

/**
 * Lowers the statements of one processing block, with control structures. leaf lowers what belongs to the kind of
 * root (WRITE, out->write( ), REPORT, ...): it returns undefined for a statement that does nothing.
 */
export class BlockLowerer {
  private loops = 0;

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
      return this.lowerCase(node);
    } else if (kind instanceof Structures.Do) {
      return [this.lowerDo(node)];
    } else if (kind instanceof Structures.While) {
      return [this.lowerWhile(node)];
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
    }
    return this.leaf(statement, where);
  }

  /**
   * RETURN, EXIT, CONTINUE and CHECK. In a loop, the last three refer to the innermost one. Outside a loop, EXIT and
   * CHECK leave the processing block, as RETURN does everywhere.
   */
  private leaveStatement(statement: abaplint.Nodes.StatementNode, where: Where): IRStatement {
    const kind = statement.get();
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

  /**
   * CASE operand. WHEN a [OR b ...]. ... [WHEN OTHERS. ...] ENDCASE. as IF operand = a OR operand = b ... ELSEIF ...
   * ELSE: the first WHEN with a value equal to the operand by the comparison rules.
   */
  private lowerCase(node: abaplint.Nodes.StructureNode): IRStatement[] {
    const caseStatement = node.findDirectStatement(Statements.Case)!;
    const where = this.where(caseStatement);
    const operand = caseStatement.findDirectExpression(Expressions.Source)!;
    if (isArithmetic(operand)) {
      throw new BuildError(`CASE ${operand.concatTokens()}: only a literal, a variable or a subfield is supported as operand yet`, where);
    }
    if (node.findDirectStructures(Structures.Normal).some(n => n.findAllStatementNodes().some(s => !isNoop(s)))) {
      throw new BuildError("statements between CASE and the first WHEN are not supported", where);
    }
    const branches: { condition: IRCondition; body: IRStatement[] }[] = [];
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
      let condition: IRCondition | undefined;
      for (const value of values) {
        if (isArithmetic(value)) {
          throw new BuildError(`WHEN ${value.concatTokens()}: only a literal, a variable or a subfield is supported yet`, whereWhen);
        }
        const compare = lowerComparison("=", operand, value, this.variables, whereWhen);
        condition = condition === undefined ? compare : { kind: "or", left: condition, right: compare };
      }
      branches.push({ condition: condition!, body: this.body(child) });
    }
    if (otherwise === undefined && branches.length === 0) {
      throw new BuildError("CASE without WHEN: WHEN must be the first statement after CASE", where);
    }
    if (branches.length === 0) {
      return otherwise ?? []; // only WHEN OTHERS
    }
    return [{ kind: "if", branches, otherwise }];
  }

  /** DO [n TIMES]. ... ENDDO. */
  private lowerDo(node: abaplint.Nodes.StructureNode): IRStatement {
    const statement = node.findDirectStatement(Statements.Do)!;
    const where = this.where(statement);
    const children = statement.getChildren();
    let times: IRSource | undefined;
    if (children.length === 4 && children[2].concatTokens().toUpperCase() === "TIMES"
        && children[1] instanceof abaplint.Nodes.ExpressionNode && children[1].get() instanceof Expressions.Source) {
      if (isArithmetic(children[1])) {
        throw new BuildError(`DO ${children[1].concatTokens()} TIMES: only a literal, a variable or a subfield is supported yet`, where);
      }
      times = lowerSource(children[1], this.variables, where, "DO");
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
