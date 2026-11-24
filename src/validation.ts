// The checks the input must pass, the same way abaplint/transpiler validates its input: its configuration and its
// filter for ambiguous statements, from packages/transpiler/src/validation.ts (abaplint/transpiler at 055af9c8).
// Copyright (c) abaplint, MIT License, see LICENSES/abaplint-transpiler.txt.
//
// Differences: the release is v758 (the transpiler's skipVersionCheck), and forbidden_identifier is left out: it
// keeps ABAP names from clashing with the names the transpiler generates in JavaScript, which abap2go does not have.
// Some of the rules report what ABAP reports as syntax errors but abaplint's check_syntax does not (unknown types,
// methods not implemented, END OF names); see "Rules that replace the syntax check" in docs/roadmap.md.

import * as abaplint from "@abaplint/core";

/** The ABAP release the input activates on. */
export const ABAP_VERSION = abaplint.Version.v758;

const allowedObjectTypes = [
  "APIS", "APLO", "AUTH", "BDEF", "CHKC", "CHKO", "CHKV", "CLAS", "DDLS", "DDLX", "DEVC", "DOMA", "DTEL", "ENHO",
  "ENHS", "ENQU", "FUGR", "HTTP", "INTF", "IWMO", "IWOM", "IWPR", "IWSG", "IWSV", "MSAG", "NROB", "NSPC", "OA2P",
  "PARA", "PINF", "PROG", "SAJC", "SAJT", "SCO2", "WAPA", "SHLP", "SHMA", "SIA6", "SICF", "SMIM", "SPLO", "SRFC",
  "SRVB", "SRVD", "SUSC", "SUSH", "SUSO", "SXCI", "TABL", "TOBJ", "TRAN", "TTYP", "TYPE", "VCLS", "VIEW", "W3MI",
  "XSLT", "ZN01", "ZN02", "ZN03", "ZN04", "ZN05", "ZN06", "ZN07", "ZN08", "ZN09", "ZN10", "ZN11", "ZN12", "ZN13",
  "ZN14", "ZN15", "ZN16", "ZN17", "ZN18", "ZN19", "ZN20", "ZN21", "ZN22",
];

/** The abaplint configuration: every name must be in the packages (errorNamespace "."), nothing is void. */
export const config = {
  global: { files: "/**/*.*" },
  syntax: { version: ABAP_VERSION, errorNamespace: "." },
  rules: {
    when_others_last: true,
    avoid_use: {
      execSQL: true,
      kernelCall: true,
      communication: true,
      systemCall: true,
      break: false,
      statics: false,
      endselect: false,
      defaultKey: false,
    },
    parser_error: true,
    allowed_object_types: { allowed: allowedObjectTypes },
    unknown_types: true,
    ambiguous_statement: true,
    implement_methods: true,
    begin_end_names: true,
    check_syntax: true,
    form_no_dash: true,
  },
};

/** The issues of the registry under the configuration; every one is an error. */
export function validate(registry: abaplint.IRegistry): readonly abaplint.Issue[] {
  registry.setConfig(new abaplint.Config(JSON.stringify(config)));
  const scopes = new Map<abaplint.ABAPObject, abaplint.ISpaghettiScope>();
  return registry.findIssues().filter(i => i.getKey() !== "ambiguous_statement" || !isUnambiguous(registry, i, scopes));
}

/**
 * DELETE name., DELETE name FROM x., MODIFY name. and MODIFY name FROM x. read two ways, so abaplint calls them
 * ambiguous. ABAP decides by the name: a variable of table type is the internal table, anything else the database
 * table.
 */
function isUnambiguous(registry: abaplint.IRegistry, issue: abaplint.Issue,
                       scopes: Map<abaplint.ABAPObject, abaplint.ISpaghettiScope>): boolean {
  const file = registry.getFileByName(issue.getFilename());
  const obj = file ? registry.findObjectForFile(file) : undefined;
  if (!(obj instanceof abaplint.ABAPObject)) {
    return false;
  }
  const statement = obj.getABAPFileByName(issue.getFilename())?.getStatements()
    .find(s => s.getStart().equals(issue.getStart()));
  const token = statement?.getTokens()[1];
  if (statement === undefined || token === undefined || token.getStr().toUpperCase() === "TABLE") {
    return false;
  }
  const modify = statement.getFirstToken().getStr().toUpperCase() === "MODIFY";
  if (!modify && !(statement.get() instanceof abaplint.Statements.DeleteInternal)) {
    return false;
  }
  let spaghetti = scopes.get(obj);
  if (spaghetti === undefined) {
    spaghetti = new abaplint.SyntaxLogic(registry, obj).run().spaghetti;
    scopes.set(obj, spaghetti);
  }
  const variable = spaghetti.lookupPosition(token.getStart(), issue.getFilename())?.findVariable(token.getStr());
  if (variable?.getType() instanceof abaplint.BasicTypes.TableType) {
    return true;
  }
  return variable !== undefined || statement.findExpressionAfterToken("FROM") !== undefined;
}
