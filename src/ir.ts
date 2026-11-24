// The IR: plain data, no classes, no JS-specific tricks, so it ports to Go file by file if that is ever decided.

/** One compilation root and what it runs. */
export type IRRoot = IRReport | IRClassrun;

/** An executable program: its START-OF-SELECTION writes the basic list. */
export interface IRReport {
  kind: "report";
  /** Program name, upper case. */
  name: string;
  /** LINE-SIZE of REPORT, undefined if not given (the runtime's default then applies). */
  lineSize: number | undefined;
  /** START-OF-SELECTION, including the statements before any event keyword. */
  body: IRStatement[];
}

/** A class implementing IF_OO_ADT_CLASSRUN: an instance is created and MAIN runs with the console as OUT. */
export interface IRClassrun {
  kind: "classrun";
  /** Class name, upper case. */
  name: string;
  /** The body of IF_OO_ADT_CLASSRUN~MAIN. */
  body: IRStatement[];
}

/** An elementary type, as the runtime's abap.Type. b and s are not declared by the compiler yet. */
export type IRType =
  | { kind: "c" | "n" | "x"; length: number }
  | { kind: "p"; length: number; decimals: number }
  | { kind: "d" | "t" | "string" | "xstring" | "i" | "int8" | "b" | "s" | "f" | "decfloat16" | "decfloat34" | "utclong" };

/** An operand: a literal or a variable. */
export type IRSource = IRLiteral | IRVariable;

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

export type IRStatement = IRListWrite | IRConsoleWrite | IRData | IRMove;

/** WRITE [/] of a literal, onto the basic list. */
export interface IRListWrite {
  kind: "list_write";
  /** `/` was given: start a new line first. */
  newLine: boolean;
  /** The characters written. */
  text: string;
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
  target: IRVariable;
  source: IRSource;
}
