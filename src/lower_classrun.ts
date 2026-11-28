import * as abaplint from "@abaplint/core";
import { BuildError, lowerAll, lowerEach, notCompiled } from "./errors";
import { IRClassrun, IRStatement } from "./ir";
import { lowerSource, Variables, Where } from "./lower_common";
import { BlockLowerer } from "./lower_block";

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
    throw notCompiled(`root ${name}: a class root must implement ${CLASSRUN} itself, other classes are not compiled as roots yet`);
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

  const variables = new Variables(registry, obj, file, new Set(definition.methods.map(m => m.name.toLowerCase())));
  const lowerer = new BlockLowerer(file, variables, (statement, where) => {
    if (statement.get() instanceof Statements.Call) {
      return lowerOutWrite(statement, variables, where);
    }
    throw notCompiled(`statement ${statement.get().constructor.name} is not compiled yet`, where);
  });
  // Creating the instance runs constructors; none are compiled yet.
  const additions = [
    ...definition.superClassName === undefined ? [] : ["INHERITING FROM"],
    ...definition.methods.map(m => m.name.toUpperCase()).filter(m => m === "CONSTRUCTOR" || m === "CLASS_CONSTRUCTOR"),
  ];
  const [, body] = lowerAll(
    () => lowerEach(additions, addition => {
      throw notCompiled(`root ${name}: ${addition} is not compiled yet`);
    }),
    () => lowerer.lower(method.getChildren().slice(1, -1))); // without METHOD and ENDMETHOD
  return { kind: "classrun", name, body };
}

/** out->write( x ). or out->write( data = x [name = y] ). with literals and variables. */
function lowerOutWrite(statement: abaplint.Nodes.StatementNode, variables: Variables, where: Where): IRStatement {
  const unsupported = () => notCompiled(`${statement.concatTokens()}: only out->write( ... ) is compiled yet`, where);

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
  const dataSource = data;
  const [value, label] = lowerAll(
    () => lowerSource(dataSource, variables, where, "out->write of"),
    () => name === undefined ? undefined : lowerSource(name, variables, where, "out->write name"));
  return { kind: "console_write", value, name: label };
}
