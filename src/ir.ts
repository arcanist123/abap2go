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

export type IRStatement = IRListWrite | IRConsoleWrite;

/** WRITE [/] of a literal, onto the basic list. */
export interface IRListWrite {
  kind: "list_write";
  /** `/` was given: start a new line first. */
  newLine: boolean;
  /** The characters written. */
  text: string;
}

/** out->write( data [name] ) with literals, on the classrun console. */
export interface IRConsoleWrite {
  kind: "console_write";
  /** DATA converted to a string. */
  value: string;
  /** NAME as a string, "" when not supplied. */
  name: string;
}
