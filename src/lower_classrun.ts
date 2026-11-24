import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { IRClassrun, IRStatement } from "./ir";
import { isNoop, lowerData, lowerMove, lowerSource, position, Variables, Where } from "./lower_common";

const { Statements, Expressions, Structures } = abaplint;

const CLASSRUN = "IF_OO_ADT_CLASSRUN";
const MAIN = "IF_OO_ADT_CLASSRUN~MAIN";

/** Lowers a class implementing IF_OO_ADT_CLASSRUN: what runs is creating an instance and calling MAIN. */
export function lowerClassrun(registry: abaplint.IRegistry, obj: abaplint.Objects.Class): IRClassrun {
  const name = obj.getName();
  const definition = obj.getClassDefinition();
  if (definition === undefined) {
    throw new BuildError(`root ${name}: no class definition found`);
  }
  if (!definition.interfaces.some(i => i.name.toUpperCase() === CLASSRUN)) {
    throw new BuildError(`root ${name}: a class root must implement ${CLASSRUN} itself`);
  }
  // Creating the instance runs constructors; none are supported yet.
  if (definition.superClassName !== undefined) {
    throw new BuildError(`root ${name}: INHERITING FROM is not supported yet`);
  }
  for (const method of definition.methods) {
    const methodName = method.name.toUpperCase();
    if (methodName === "CONSTRUCTOR" || methodName === "CLASS_CONSTRUCTOR") {
      throw new BuildError(`root ${name}: ${methodName} is not supported yet`);
    }
  }
  if (definition.isAbstract) {
    throw new BuildError(`root ${name}: an abstract class cannot be instantiated`);
  }

  const file = obj.getMainABAPFile();
  const structure = file?.getStructure();
  if (file === undefined || structure === undefined) {
    throw new BuildError(`root ${name}: the class pool has no main source`);
  }
  const method = structure.findAllStructures(Structures.Method).find(m =>
    m.findDirectStatement(Statements.MethodImplementation)?.findDirectExpression(Expressions.MethodName)?.concatTokens().toUpperCase() === MAIN);
  if (method === undefined) {
    throw new BuildError(`root ${name}: METHOD ${MAIN.toLowerCase()} not found`);
  }

  const variables = new Variables(registry, obj, file);
  const statements = method.findAllStatementNodes();
  const body: IRStatement[] = [];
  for (const statement of statements.slice(1, -1)) { // without METHOD and ENDMETHOD
    const where = position(file, statement);
    if (isNoop(statement)) {
      continue;
    } else if (statement.get() instanceof Statements.Data) {
      body.push(lowerData(statement, variables, where));
    } else if (statement.get() instanceof Statements.Move) {
      body.push(lowerMove(statement, variables, where));
    } else if (statement.get() instanceof Statements.Call) {
      body.push(lowerOutWrite(statement, variables, where));
    } else {
      throw new BuildError(`statement ${statement.get().constructor.name} is not supported yet`, where);
    }
  }
  return { kind: "classrun", name, body };
}

/** out->write( x ). or out->write( data = x [name = y] ). with literals and variables. */
function lowerOutWrite(statement: abaplint.Nodes.StatementNode, variables: Variables, where: Where): IRStatement {
  const unsupported = () => new BuildError(`${statement.concatTokens()}: only out->write( ... ) is supported yet`, where);

  const chain = statement.findDirectExpression(Expressions.MethodCallChain);
  const parts = chain?.getChildren() ?? [];
  if (chain === undefined || statement.getChildren().length !== 2 || parts.length !== 3
      || parts[0].concatTokens().toLowerCase() !== "out" || parts[1].concatTokens() !== "->"
      || !(parts[2] instanceof abaplint.Nodes.ExpressionNode)) {
    throw unsupported();
  }
  const call = parts[2];
  if (call.findDirectExpression(Expressions.MethodName)?.concatTokens().toLowerCase() !== "write") {
    throw unsupported();
  }
  const param = call.findDirectExpression(Expressions.MethodCallParam);
  if (param === undefined) {
    throw unsupported();
  }

  let data: abaplint.Nodes.ExpressionNode | undefined;
  let name: abaplint.Nodes.ExpressionNode | undefined;
  const single = param.findDirectExpression(Expressions.Source);
  const list = param.findDirectExpression(Expressions.ParameterListS);
  if (single !== undefined) {
    data = single;
  } else if (list !== undefined) {
    for (const p of list.findDirectExpressions(Expressions.ParameterS)) {
      const pName = p.findDirectExpression(Expressions.ParameterName)?.concatTokens().toLowerCase();
      const pSource = p.findDirectExpression(Expressions.Source);
      if (pName === "data") {
        data = pSource;
      } else if (pName === "name") {
        name = pSource;
      }
    }
  }
  if (data === undefined) {
    throw unsupported();
  }

  // DATA is TYPE any and is converted to a string by the console; NAME is TYPE string, converted when passed.
  return {
    kind: "console_write",
    value: lowerSource(data, variables, where, "out->write of"),
    name: name === undefined ? undefined : lowerSource(name, variables, where, "out->write name"),
  };
}
