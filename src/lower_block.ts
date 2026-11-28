import * as abaplint from "@abaplint/core";
import { lowerAll, lowerEach, notCompiled } from "./errors";
import { IRCase, IRComparand, IRCondition, IRDo, IRStatement, IRTry } from "./ir";
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

  constructor(private readonly file: abaplint.ABAPFile, private readonly variables: Variables,
      private readonly leaf: (statement: abaplint.Nodes.StatementNode, where: Where) => IRStatement | undefined) {}

  /**
   * The statements and structures of nodes, in order. Every one is lowered, also after one that is not compiled yet,
   * so that all findings are reported together.
   */
  lower(nodes: readonly Node[]): IRStatement[] {
    return lowerEach(nodes, node => {
      if (node instanceof abaplint.Nodes.StatementNode) {
        const s = this.statement(node);
        return s === undefined ? [] : [s];
      }
      return node instanceof abaplint.Nodes.StructureNode ? this.structure(node) : [];
    }).flat();
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
    // a structure that is not compiled is reported, and then what the blocks inside it lack
    const where = this.where(node);
    lowerAll(() => {
      throw notCompiled(`${kind.constructor.name} is not compiled yet`, where);
    }, () => this.blocksInside(node));
    return [];
  }

  /** Lowers every Body below node, however deep, for its findings. */
  private blocksInside(node: abaplint.Nodes.StructureNode): void {
    lowerEach(node.getChildren(), child => {
      if (child instanceof abaplint.Nodes.StructureNode) {
        if (child.get() instanceof Structures.Body) {
          this.lower(child.getChildren());
        } else {
          this.blocksInside(child);
        }
      }
    });
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
    if (kind instanceof Statements.Check) {
      const cond = statement.findDirectExpression(Expressions.Cond);
      if (cond === undefined) {
        throw notCompiled(`${statement.concatTokens()}: only CHECK <condition>. is compiled yet`, where);
      }
      const leaves = this.loops === 0 ? "block" : "pass";
      return { kind: "check", condition: lowerCondition(cond, this.variables, where), leaves };
    }
    if (statement.getChildren().length !== 2) {
      throw notCompiled(`${statement.concatTokens()}: no additions are compiled yet`, where);
    }
    if (kind instanceof Statements.Continue) {
      // outside a loop, a syntax error of layer 2 (src/check/loops.ts)
      return { kind: "continue" };
    }
    return kind instanceof Statements.Exit && this.loops > 0 ? { kind: "exit" } : { kind: "return" };
  }

  /** IF cond. ... [ELSEIF cond. ...]* [ELSE. ...] ENDIF. */
  private lowerIf(node: abaplint.Nodes.StructureNode): IRStatement {
    const clauses = [
      { statement: node.findDirectStatement(Statements.If)!, block: node },
      ...node.findDirectStructures(Structures.ElseIf).map(
        block => ({ statement: block.findDirectStatement(Statements.ElseIf)!, block })),
    ];
    const elseNode = node.findDirectStructure(Structures.Else);
    const [branches, otherwise] = lowerAll(
      () => lowerEach(clauses, ({ statement, block }) => {
        const [condition, body] = lowerAll(() => this.condition(statement), () => this.body(block));
        return { condition, body };
      }),
      () => elseNode === undefined ? undefined : this.body(elseNode));
    return { kind: "if", branches, otherwise };
  }

  /**
   * CASE operand. WHEN a [OR b ...]. ... [WHEN OTHERS. ...] ENDCASE. In a program outside classes, statements may
   * stand before the first WHEN, and there may be no WHEN at all.
   */
  private lowerCase(node: abaplint.Nodes.StructureNode): IRCase {
    const caseStatement = node.findDirectStatement(Statements.Case)!;
    const where = this.where(caseStatement);
    let compared: IRComparand | undefined;
    const [operand, first, clauses] = lowerAll(
      () => compared = caseOperand(caseStatement.findDirectExpression(Expressions.Source)!, this.variables, where),
      () => this.lower(node.findDirectStructures(Structures.Normal)),
      () => lowerEach(node.getChildren(), child => this.caseClause(child, compared)));
    const branches: IRCase["branches"] = [];
    let otherwise: IRStatement[] | undefined;
    for (const clause of clauses) {
      if (clause?.values !== undefined) {
        branches.push({ values: clause.values, body: clause.body });
      } else if (clause !== undefined) {
        otherwise = clause.body;
      }
    }
    return { kind: "case", operand, first, branches, otherwise };
  }

  /**
   * A direct child of a CASE: a WHEN with its block, without values for WHEN OTHERS; undefined for what is lowered
   * elsewhere or does nothing. operand is undefined when the operand of CASE is not compiled.
   */
  private caseClause(child: Node, operand: IRComparand | undefined):
      { values: IRCase["branches"][number]["values"] | undefined; body: IRStatement[] } | undefined {
    if (child instanceof abaplint.Nodes.StatementNode && !isNoop(child) && !(child.get() instanceof Statements.Case)
        && !(child.get() instanceof Statements.EndCase)) {
      throw notCompiled(`${child.concatTokens()}: not compiled in CASE yet`, this.where(child));
    }
    if (!(child instanceof abaplint.Nodes.StructureNode) || !(child.get() instanceof Structures.When)) {
      return undefined;
    }
    const whenStatement = child.findDirectStatement(Statements.When);
    if (whenStatement === undefined) { // WHEN OTHERS
      return { values: undefined, body: this.body(child) };
    }
    const where = this.where(whenStatement);
    const sources = [whenStatement.findDirectExpression(Expressions.Source)!,
      ...whenStatement.findDirectExpressions(Expressions.Or).map(o => o.findDirectExpression(Expressions.Source)!)];
    const [values, body] = lowerAll(
      () => lowerEach(sources, s => caseValue(operand, s, this.variables, where)),
      () => this.body(child));
    return { values, body };
  }

  /** DO [n TIMES]. ... ENDDO. */
  private lowerDo(node: abaplint.Nodes.StructureNode): IRStatement {
    const statement = node.findDirectStatement(Statements.Do)!;
    const where = this.where(statement);
    const [times, body] = lowerAll(() => this.times(statement, where), () => this.loopBody(node));
    return { kind: "do", times, body };
  }

  /** The number of passes of DO n TIMES, undefined for DO without it. */
  private times(statement: abaplint.Nodes.StatementNode, where: Where): IRDo["times"] {
    const children = statement.getChildren();
    if (children.length === 4 && children[2].concatTokens().toUpperCase() === "TIMES"
        && children[1] instanceof abaplint.Nodes.ExpressionNode && children[1].get() instanceof Expressions.Source) {
      return isArithmetic(children[1])
        ? { kind: "into_i", expression: lowerArithmetic(children[1], this.variables, where) }
        : lowerSource(children[1], this.variables, where, "DO");
    } else if (children.length !== 2) {
      throw notCompiled(`${statement.concatTokens()}: only DO and DO n TIMES are compiled yet, not VARYING`, where);
    }
    return undefined;
  }

  /** WHILE cond. ... ENDWHILE. */
  private lowerWhile(node: abaplint.Nodes.StructureNode): IRStatement {
    const statement = node.findDirectStatement(Statements.While)!;
    const [, condition, body] = lowerAll(
      () => {
        if (statement.getChildren().length !== 3) {
          throw notCompiled(`${statement.concatTokens()}: VARY is not compiled yet`, this.where(statement));
        }
      },
      () => this.condition(statement),
      () => this.loopBody(node));
    return { kind: "while", condition, body };
  }

  /** TRY. ... [CATCH cx ... . ...]* [CLEANUP. ...] ENDTRY. */
  private lowerTry(node: abaplint.Nodes.StructureNode): IRStatement {
    const cleanupNode = node.findDirectStructure(Structures.Cleanup);
    const [body, catches, cleanup] = lowerAll(
      () => this.body(node),
      () => lowerEach(node.findDirectStructures(Structures.Catch), c => this.lowerCatch(c)),
      () => cleanupNode === undefined ? undefined : this.lowerCleanup(cleanupNode));
    return { kind: "try", body, catches, cleanup };
  }

  /** CATCH cx ... . and its block. */
  private lowerCatch(node: abaplint.Nodes.StructureNode): IRTry["catches"][number] {
    const statement = node.findDirectStatement(Statements.Catch)!;
    const where = this.where(statement);
    const [, , classes, body] = lowerAll(
      () => {
        if (statement.findDirectTokenByText("UNWIND") !== undefined) {
          throw notCompiled("CATCH BEFORE UNWIND is not compiled yet", where);
        }
      },
      () => {
        if (statement.findDirectExpression(Expressions.Target) !== undefined) {
          throw notCompiled("CATCH ... INTO is not compiled yet: object references are not compiled", where);
        }
      },
      () => lowerEach(statement.findDirectExpressions(Expressions.ClassName),
        name => catchClasses(this.variables.registry, name.concatTokens(), where)),
      () => this.body(node));
    return { classes: [...new Set(classes.flat())].sort(), body };
  }

  /** CLEANUP. and its block. */
  private lowerCleanup(node: abaplint.Nodes.StructureNode): IRStatement[] {
    const statement = node.findDirectStatement(Statements.Cleanup)!;
    const [, body] = lowerAll(
      () => {
        if (statement.findDirectExpression(Expressions.Target) !== undefined) {
          throw notCompiled("CLEANUP INTO is not compiled yet: object references are not compiled", this.where(statement));
        }
      },
      () => this.body(node));
    return body;
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
 * runtime raises exceptions by the name of their class, so a CATCH clause is the set of names it matches. The
 * exception classes the runtime raises are in the built-in library.
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
    throw notCompiled(`CATCH ${name}: only global exception classes are compiled yet`, where);
  }
  const ancestors = (c: string): string[] => {
    const out: string[] = [];
    for (let p: string | undefined = c; p !== undefined && !out.includes(p); p = parents.get(p)) {
      out.push(p);
    }
    return out;
  };
  return [...parents.keys()].filter(c => ancestors(c).includes(upper));
}
