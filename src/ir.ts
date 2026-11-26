// The IR: plain data, no classes, no JS-specific tricks, so it ports to Go file by file if that is ever decided.

/** One compilation root and what it runs. */
export type IRRoot = IRReport | IRClassrun;

/** An executable program: its START-OF-SELECTION event blocks write the basic list. */
export interface IRReport {
  kind: "report";
  /** Program name, upper case. */
  name: string;
  /** LINE-SIZE of REPORT, undefined if not given (the runtime's default then applies). */
  lineSize: number | undefined;
  /**
   * The START-OF-SELECTION event blocks in the order they run, the first one holding the statements before any event
   * keyword. Each block starts a new line of the list.
   */
  blocks: IRStatement[][];
}

/** A class implementing IF_OO_ADT_CLASSRUN: an instance is created and MAIN runs with the console as OUT. */
export interface IRClassrun {
  kind: "classrun";
  /** Class name, upper case. */
  name: string;
  /** The body of IF_OO_ADT_CLASSRUN~MAIN. */
  body: IRStatement[];
}

/** An elementary type, as the runtime's abap.Type. b and s come from DDIC INT1 and INT2. */
export type IRType =
  | { kind: "c" | "n" | "x"; length: number }
  | { kind: "p"; length: number; decimals: number }
  | { kind: "d" | "t" | "string" | "xstring" | "i" | "int8" | "b" | "s" | "f" | "decfloat16" | "decfloat34" | "utclong" };

/** An operand: a literal, a variable, a subfield of a variable or a system field. */
export type IRSource = IRLiteral | IRVariable | IRSubstring | IRSystemField;

/** A system field that compiled code reads: sy-index (type i), set by DO and WHILE. */
export interface IRSystemField {
  kind: "system_field";
  name: "index";
  type: IRType;
}

/** An operand of a comparison of data objects: a source, a built-in function of one, or the result CASE compares. */
export type IRComparand = IRSource | IRFunction | IRResult;

/**
 * abs( ), sqrt( ) or strlen( ) of a single data object as an operand of a comparison of data objects: it is not an
 * arithmetic expression but a value of the type of its result, calculated on its own (abap.ValueOf) when its
 * relational expression is evaluated.
 */
export interface IRFunction {
  kind: "function";
  /** The call: strlen, or abs or sqrt of an operand. */
  call: IRExpr;
  /** The type of the result. The p of abs( ) of a text gets its decimals at run time: they are 0 here. */
  type: IRType;
}

/**
 * The operand of CASE that is an arithmetic expression: calculated once, in the calculation type of its own operands,
 * and then compared as a data object of that type (abap.CaseValue). The decimals of a p are known at run time.
 */
export interface IRResult {
  kind: "result";
  expression: IRExpr;
}

/** What a value is written to: a variable or a subfield of a flat variable. */
export type IRTarget = IRVariable | IRSubstring;

/** A literal with its ABAP type: a text field literal (c of its length), a string literal or an integer (i). */
export interface IRLiteral {
  kind: "literal";
  type: IRType;
  /** The characters of a c or string literal, the decimal digits (with sign) of an integer. */
  value: string;
}

/** A variable, by its ABAP name (lower case). */
export interface IRVariable {
  kind: "variable";
  name: string;
  type: IRType;
}

/**
 * Offset/length access base+offset(length), base+offset or base(length) on a variable of type c, n, d, t, string, x
 * or xstring. Offsets and lengths count characters (UTF-16 code units) or bytes. The subfield of c is a c, of n, d
 * and t an n, of x an x, of string and xstring the same; its length, and so its type, is only known at run time
 * when the offset or length is a variable, so the runtime gives it (abap.Substring), which also checks the bounds.
 */
export interface IRSubstring {
  kind: "substring";
  base: IRVariable;
  /** An i literal or a variable; undefined for base(length). */
  offset: IRLiteral | IRVariable | undefined;
  /** An i literal or a variable; undefined for the rest of base. */
  length: IRLiteral | IRVariable | undefined;
  /** The type of the subfield, with the length known at build time: the length of base when it is not. */
  type: IRType;
}

export type IRStatement = IRListWrite | IRConsoleWrite | IRData | IRMove | IRCalculate | IRAssert
  | IRIf | IRCase | IRDo | IRWhile | IRExit | IRContinue | IRCheck | IRReturn | IRTry | IRRetry;

/**
 * TRY. body CATCH ... [CLEANUP. ...] ENDTRY. An exception raised in the body (also in a procedure it calls) goes to
 * the first CATCH clause that names its class or a superclass; one that no TRY catches ends the program without
 * running any CLEANUP block. When an outer TRY catches it, the CLEANUP block runs first. An exception raised in a
 * CATCH block goes to the TRYs further out, and one that leaves a CLEANUP block ends the program. A statement whose
 * exception leaves a value in its target (docs/spec/conversion.md) stores that value before raising.
 */
export interface IRTry {
  kind: "try";
  body: IRStatement[];
  /**
   * The CATCH clauses in order. classes: the exception classes the clause catches, upper case: the classes it names
   * and all their subclasses in the world of the build.
   */
  catches: { classes: string[]; body: IRStatement[] }[];
  /** undefined without CLEANUP. */
  cleanup: IRStatement[] | undefined;
}

/** RETRY in a CATCH block: the TRY block of that TRY runs again. */
export interface IRRetry {
  kind: "retry";
}

/** IF / ELSEIF / ELSE: the body of the first branch whose condition holds, else the ELSE body. */
export interface IRIf {
  kind: "if";
  branches: { condition: IRCondition; body: IRStatement[] }[];
  /** undefined without ELSE. */
  otherwise: IRStatement[] | undefined;
}

/**
 * CASE: the operand is evaluated first, also when no WHEN compares it. Then the body of the first branch with a value
 * equal to it runs, by the comparison operand = value; the values are evaluated in order, up to that one.
 */
export interface IRCase {
  kind: "case";
  operand: IRComparand;
  /** The WHEN blocks in order; a value is never a result. */
  branches: { values: IRComparand[]; body: IRStatement[] }[];
  /** WHEN OTHERS; undefined without one. */
  otherwise: IRStatement[] | undefined;
}

/**
 * DO [n TIMES]: n is converted to i once, before the first pass; no passes when it is 0 or less. An arithmetic
 * expression or a built-in function as n is calculated as for an i result field (into_i). sy-index is the number of
 * the pass in the body and is set back to its value before the loop when the loop ends.
 */
export interface IRDo {
  kind: "do";
  times: IRSource | { kind: "into_i"; expression: IRExpr } | undefined;
  body: IRStatement[];
}

/** WHILE condition: sy-index is set to the number of the pass before the condition is evaluated. */
export interface IRWhile {
  kind: "while";
  condition: IRCondition;
  body: IRStatement[];
}

/** EXIT in a loop: leaves the innermost loop. */
export interface IRExit {
  kind: "exit";
}

/** CONTINUE in a loop: goes on with the next pass of the innermost loop. */
export interface IRContinue {
  kind: "continue";
}

/**
 * CHECK condition: when the condition does not hold, it leaves what it stands in. In a loop it goes on with the next
 * pass of the innermost loop; outside a loop it leaves its processing block, and in a report the next
 * START-OF-SELECTION block then runs.
 */
export interface IRCheck {
  kind: "check";
  condition: IRCondition;
  leaves: "pass" | "block";
}

/**
 * RETURN, and EXIT outside a loop: ends the method, or START-OF-SELECTION with all the blocks still to run. The list
 * is written all the same.
 */
export interface IRReturn {
  kind: "return";
}

/** ASSERT condition: when the condition does not hold, the program ends with the runtime error ASSERTION_FAILED. */
export interface IRAssert {
  kind: "assert";
  condition: IRCondition;
}

/** A relational operator, in its symbolic form (EQ is =, NE and >< are <>, =< is <=, => is >=). */
export type IRCompareOp = "=" | "<>" | "<" | ">" | "<=" | ">=";

/**
 * A logical expression (docs/spec/comparison.md). A comparison of two data objects, functions of data objects among
 * them, follows the comparison rules (abap.Compare), and a conversion error in the comparison is a runtime error. With
 * an arithmetic expression on either side, the calculation type of all operands of the comparison is also its
 * comparison type, and an error is the catchable exception of the calculation. AND and OR evaluate from left to right and stop once the value is known; both sides
 * of EQUIV are evaluated.
 */
export type IRCondition =
  | { kind: "compare"; op: IRCompareOp; left: IRComparand; right: IRComparand }
  | { kind: "compare_calc"; op: IRCompareOp; left: IRExpr; right: IRExpr }
  /**
   * BETWEEN with an arithmetic expression: operand >= low AND operand <= high in one calculation type for all
   * three operands. BETWEEN of data objects is lowered to the two comparisons joined by AND.
   */
  | { kind: "between_calc"; operand: IRExpr; low: IRExpr; high: IRExpr }
  | { kind: "not"; operand: IRCondition }
  | { kind: "and" | "or" | "equiv"; left: IRCondition; right: IRCondition };

/** WRITE [/] of a literal or variable onto the basic list, formatted with the session's user settings. */
export interface IRListWrite {
  kind: "list_write";
  /** `/` was given: start a new line first. */
  newLine: boolean;
  /** What is written. A text literal is written as it is, with its trailing blanks; '' is one blank. */
  value: IRSource;
}

/** out->write( data [name] ) on the classrun console. DATA is converted to string, as is NAME. */
export interface IRConsoleWrite {
  kind: "console_write";
  value: IRSource;
  /** undefined when NAME is not supplied. */
  name: IRSource | undefined;
}

/** DATA name TYPE type [VALUE literal]: the variable starts with its initial value or the converted literal. */
export interface IRData {
  kind: "data";
  variable: IRVariable;
  value: IRLiteral | undefined;
}

/** target = source: the conversion rules of the runtime (abap.Convert) apply. */
export interface IRMove {
  kind: "move";
  target: IRTarget;
  source: IRSource;
}

/**
 * target = arithmetic expression: the calculation type table of docs/spec/calculation.md (abap.Calculate). The
 * assignment operators (+= -= *= /=) are lowered to target = target op ( expression ).
 */
export interface IRCalculate {
  kind: "calculate";
  target: IRTarget;
  expression: IRExpr;
}

export type IRArithOp = "+" | "-" | "*" | "/" | "DIV" | "MOD" | "**";

/**
 * An arithmetic expression. A number literal beyond the range of i is an operand of type p. strlen( ) is an operand
 * of type i: the characters of a character-like operand, without the trailing blanks of a flat one.
 */
export type IRExpr =
  | { kind: "strlen"; arg: IRSource }
  | { kind: "operand"; source: IRSource }
  | { kind: "binary"; op: IRArithOp; left: IRExpr; right: IRExpr }
  | { kind: "unary"; fn: "-" | "abs" | "sqrt"; operand: IRExpr }
  | { kind: "ipow"; base: IRExpr; exp: IRExpr };
