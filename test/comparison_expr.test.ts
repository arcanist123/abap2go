import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { classrun, run } from "./harness";

// The cells of runtime/go/abap/testdata/comparison_expr.tsv (logical expressions, arithmetic operands, BETWEEN,
// literals and syntax errors, see docs/spec/comparison.md) that the compiler supports, compiled as IF and run end to
// end. Not compiled yet, so left out: predicates (IS INITIAL), constructor expressions (CONV), built-in functions as
// single operands (abs( ), strlen( ), boolc( ), xsdbool( ), utclong_current( )) and abap_true.

const FILE = path.join(__dirname, "..", "..", "runtime", "go", "abap", "testdata", "comparison_expr.tsv");

const NOT_COMPILED = /\bIS\b|\bCONV\b|^(abs|strlen|boolc|xsdbool|utclong_current)\(|\babap_true\b/;

interface Cell {
  line: number;
  expression: string;
  operands: { name: string; type: string; value: string }[];
  expected: "T" | "F" | "SYNTAX" | { exception: string };
}

/** The ABAP type of a cell type name: i, int8, f, decfloat34, string, xstring, d, t, utclong, pL.D, cN, nN, xN. */
function abapType(name: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^p(\d+)\.(\d+)$/.exec(name)) !== null) {
    return `p LENGTH ${m[1]} DECIMALS ${m[2]}`;
  }
  if ((m = /^([cnx])(\d+)$/.exec(name)) !== null) {
    return `${m[1]} LENGTH ${m[2]}`;
  }
  if (/^(i|int8|f|decfloat34|string|xstring|d|t|utclong)$/.test(name)) {
    return name;
  }
  throw new Error(`type ${name}`);
}

function parse(): Cell[] {
  const cells: Cell[] = [];
  fs.readFileSync(FILE, "utf-8").split(/\r?\n/).forEach((text, i) => {
    if (text === "" || text.startsWith("#")) {
      return;
    }
    const [expression, operandText, result] = text.split("\t");
    if (NOT_COMPILED.test(expression)) {
      return;
    }
    const operands = [...operandText.matchAll(/(\w+)=([\w.]+)\[([^\]]*)\]/g)].map(m => ({ name: m[1], type: m[2], value: m[3] }));
    const exc = /^EXC:([A-Z_]+)$/.exec(result);
    const expected = exc !== null ? { exception: exc[1] } : result as "T" | "F" | "SYNTAX";
    cells.push({ line: i + 1, expression, operands, expected });
  });
  return cells;
}

/** text with the operand names suffixed with _n, outside literals. */
function rename(text: string, names: string[], n: number): string {
  if (names.length === 0) {
    return text;
  }
  const name = new RegExp(`\\b(${names.join("|")})\\b`, "g");
  return text.split(/('[^']*'|`[^`]*`)/).map((part, k) => k % 2 === 1 ? part : part.replace(name, `$1_${n}`)).join("");
}

/** The declarations of one cell, its names suffixed with n. */
function declarations(cell: Cell, n: number): string[] {
  return cell.operands.map(o => `DATA ${o.name}_${n} TYPE ${abapType(o.type)}${o.value === "" && o.type === "utclong" ? "" : ` VALUE '${o.value}'`}.`);
}

const condition = (cell: Cell, n: number) => rename(cell.expression, cell.operands.map(o => o.name), n);

const describe = (cell: Cell) => `line ${cell.line}: ${cell.expression} with `
  + (cell.operands.map(o => `${o.name} = ${o.type}[${o.value}]`).join(", ") || "no operands");

const cells = parse();

test("comparison expressions: the true and false cells, in one program", () => {
  let cases = cells.filter(c => c.expected === "T" || c.expected === "F");
  const differences: string[] = [];
  let result: ReturnType<typeof run>;
  // A refused cell is reported and left out, so that the others still run.
  for (;;) {
    const body: string[] = [];
    const firstLine: number[] = [];
    cases.forEach((cell, n) => {
      firstLine.push(body.length);
      body.push(...declarations(cell, n), `IF ${condition(cell, n)}.`, "  out->write( 'T' ).", "ELSE.", "  out->write( 'F' ).", "ENDIF.");
    });
    result = run("clas", classrun(body.join("\n")));
    if (result.refused === undefined) {
      break;
    }
    // classrun( ) puts the body after 6 lines of class source
    const row = /\.abap:(\d+):/.exec(result.refused)?.[1];
    if (row === undefined) {
      assert.fail(result.refused);
    }
    const index = firstLine.filter(l => l <= parseInt(row, 10) - 7).length - 1;
    if (index < 0) {
      assert.fail(result.refused);
    }
    differences.push(`${describe(cases[index])}: refused: ${result.refused.replace(/^.*?\.abap:\d+:\d+: /, "")}`);
    cases = cases.filter((_, k) => k !== index);
  }
  const lines = (result.stdout ?? "").split("\n");
  cases.forEach((cell, n) => {
    if (lines[n] !== cell.expected) {
      differences.push(`${describe(cell)}: got ${JSON.stringify(lines[n])}, want ${cell.expected}`);
    }
  });
  if (result.failed !== undefined) {
    differences.push(`ended after ${lines.length - 1} cells: ${result.failed}`);
  }
  assert.deepEqual(differences, []);
});

for (const cell of cells.filter(c => typeof c.expected === "object")) {
  const exception = (cell.expected as { exception: string }).exception;
  test(`comparison expressions: ${describe(cell)} raises ${exception}`, () => {
    const body = [...declarations(cell, 0), `IF ${condition(cell, 0)}.`, "ENDIF.", "out->write( 'not raised' )."].join("\n");
    const result = run("clas", classrun(body));
    assert.equal(result.refused, undefined, result.refused);
    assert.equal(result.stdout, "");
    assert.match(result.failed ?? "", new RegExp(`exception ${exception} not caught`));
  });
}

for (const cell of cells.filter(c => c.expected === "SYNTAX")) {
  test(`comparison expressions: ${describe(cell)} is refused`, () => {
    const declared = declarations(cell, 0);
    const result = run("clas", classrun([...declared, `IF ${condition(cell, 0)}.`, "ENDIF."].join("\n")));
    assert.ok(result.refused !== undefined, `built, stdout ${JSON.stringify(result.stdout)}`);
    // refused for the condition, not for a declaration
    assert.match(result.refused, new RegExp(`\\.abap:${7 + declared.length}:`), result.refused);
  });
}
