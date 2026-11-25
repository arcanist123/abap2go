import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { classrun, dtel, run } from "./harness";

// The cells of runtime/go/abap/testdata/calculation_contexts.tsv (precedence, signs, assignment operators and
// overflow, see docs/spec/calculation.md) that the compiler supports, compiled and run end to end. The runtime's
// own tests check abap.Calculate; these check that the compiler builds the expression the source means.
// Not compiled yet, so left out: inline declarations (DATA), string templates, CONV, EXACT and ADD, SUBTRACT,
// MULTIPLY, DIVIDE. The value the result field holds after an exception cannot be observed without TRY.

const FILE = path.join(__dirname, "..", "..", "runtime", "go", "abap", "testdata", "calculation_contexts.tsv");

const DDIC = {
  ...dtel("ZBYTE", "<DATATYPE>INT1</DATATYPE><LENG>000003</LENG><OUTPUTLEN>000003</OUTPUTLEN>"),
  ...dtel("ZSHORT", "<DATATYPE>INT2</DATATYPE><LENG>000005</LENG><OUTPUTLEN>000006</OUTPUTLEN>"),
};

interface Cell {
  line: number;
  /** The result field: its type and the value it holds before the statement. */
  target: { type: string; start: string | undefined };
  /** The statement's right-hand side, an expression or an assignment operator with its operand. */
  expression: string;
  operands: { name: string; type: string; value: string }[];
  /** The expected value of the result field, or the exception class. */
  expected: { value: string } | { exception: string };
}

/** The ABAP type of a cell type name: i, int8, f, decfloat34, string, pL.D, cN, and b and s as INT1 and INT2. */
function abapType(name: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^p(\d+)\.(\d+)$/.exec(name)) !== null) {
    return `p LENGTH ${m[1]} DECIMALS ${m[2]}`;
  }
  if ((m = /^c(\d+)$/.exec(name)) !== null) {
    return `c LENGTH ${m[1]}`;
  }
  switch (name) {
    case "i": case "int8": case "f": case "decfloat34": case "string": return name;
    case "b": return "zbyte";
    case "s": return "zshort";
  }
  throw new Error(`type ${name}`);
}

/** An f given by its IEEE 754 bits as text that converts back to the same value. */
function floatText(hex: string): string {
  const buffer = Buffer.from(hex, "hex");
  const value = buffer.readDoubleBE(0);
  if (Object.is(value, -0)) {
    throw new Error("negative zero has no text form here");
  }
  return String(value).replace("e", "E");
}

function parse(): Cell[] {
  const cells: Cell[] = [];
  fs.readFileSync(FILE, "utf-8").split(/\r?\n/).forEach((text, i) => {
    if (text === "" || text.startsWith("#")) {
      return;
    }
    const cols = text.split("\t");
    const [target, expression] = cols;
    if (target === "DATA" || /\|\{|\bCONV\b|\bEXACT\b|^(ADD|SUBTRACT|MULTIPLY|DIVIDE)\b/.test(expression)) {
      return;
    }
    const [type, start] = target.replace(/\]$/, "").split("[");
    const operands = ["a", "b", "c"].flatMap((name, k) => {
      const col = cols[2 + k];
      if (col === "-") {
        return [];
      }
      const [t, value] = col.replace(/\]$/, "").split("[");
      return [{ name, type: t, value }];
    });
    const exc = /^EXC:([A-Z_]+)/.exec(cols[5]);
    const expected = exc !== null ? { exception: exc[1] }
      : { value: type === "f" ? floatText(cols[5]) : cols[5] };
    cells.push({ line: i + 1, target: { type, start }, expression, operands, expected });
  });
  return cells;
}

/** The statements of one cell, its names suffixed with n; r_n is the result field. */
function statements(cell: Cell, n: number): string[] {
  const out: string[] = [];
  for (const o of cell.operands) {
    out.push(`DATA ${o.name}_${n} TYPE ${abapType(o.type)} VALUE '${o.value}'.`);
  }
  const start = cell.target.start === undefined ? "" : ` VALUE '${cell.target.start}'`;
  out.push(`DATA r_${n} TYPE ${abapType(cell.target.type)}${start}.`);
  const expression = cell.expression.replace(/\b([abc])\b/g, `$1_${n}`);
  out.push(/^[-+*/]=/.test(expression) ? `r_${n} ${expression}.` : `r_${n} = ${expression}.`);
  return out;
}

const describe = (cell: Cell) => `line ${cell.line}: ${cell.target.type} = ${cell.expression} with `
  + cell.operands.map(o => `${o.name} = ${o.type}[${o.value}]`).join(", ");

const cells = parse();

test("calculation contexts: the cells without exception, in one program", () => {
  let ok = cells.filter(c => "value" in c.expected);
  const differences: string[] = [];
  let result: ReturnType<typeof run>;
  // A refused cell is reported and left out, so that the others still run.
  for (;;) {
    const body: string[] = [];
    const firstLine: number[] = [];
    ok.forEach((cell, n) => {
      firstLine.push(body.length);
      body.push(...statements(cell, n));
      const value = (cell.expected as { value: string }).value;
      body.push(`DATA e_${n} TYPE ${abapType(cell.target.type)} VALUE '${value}'.`);
      body.push(`out->write( r_${n} ).`, `out->write( e_${n} ).`);
    });
    result = run("clas", classrun(body.join("\n")), undefined, DDIC);
    if (result.refused === undefined) {
      break;
    }
    // classrun( ) puts the body after 6 lines of class source
    const row = /\.abap:(\d+):/.exec(result.refused)?.[1];
    if (row === undefined) {
      assert.fail(result.refused);
    }
    const index = firstLine.filter(l => l <= parseInt(row, 10) - 7).length - 1;
    differences.push(`${describe(ok[index])}: refused: ${result.refused.replace(/^.*?\.abap:\d+:\d+: /, "")}`);
    ok = ok.filter((_, k) => k !== index);
  }
  const lines = (result.stdout ?? "").split("\n");
  ok.forEach((cell, n) => {
    const [got, want] = [lines[2 * n], lines[2 * n + 1]];
    if (got !== want) {
      differences.push(`${describe(cell)}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  });
  if (result.failed !== undefined) {
    differences.push(`ended after ${Math.floor(lines.length / 2)} cells: ${result.failed}`);
  }
  assert.deepEqual(differences, []);
});

for (const cell of cells.filter(c => "exception" in c.expected)) {
  const exception = (cell.expected as { exception: string }).exception;
  test(`calculation contexts: ${describe(cell)} raises ${exception}`, () => {
    const body = [...statements(cell, 0), "out->write( 'not raised' )."].join("\n");
    const result = run("clas", classrun(body), undefined, DDIC);
    assert.equal(result.refused, undefined, result.refused);
    assert.equal(result.stdout, "");
    assert.match(result.failed ?? "", new RegExp(`exception ${exception} not caught`));
  });
}
