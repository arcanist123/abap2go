import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classrun, dtel, run } from "./harness";

// The result field after an exception, when the result of an arithmetic expression is moved into it
// (docs/spec/conversion.md, "The target after an exception", and docs/spec/calculation.md): results of every
// calculation type that do not fit integer, p, n, c, f and decfloat16 result fields, caught with TRY. Each cell is
// "<calculation type> <value> -> <result field>|<exception>|[<result field afterwards, as a string>]", the result
// field starting as 5; CO is CX_SY_CONVERSION_OVERFLOW, AO CX_SY_ARITHMETIC_OVERFLOW, - none.

const DDIC = {
  ...dtel("INT1", "<DATATYPE>INT1</DATATYPE><LENG>000003</LENG><OUTPUTLEN>000003</OUTPUTLEN>"),
  ...dtel("INT2", "<DATATYPE>INT2</DATATYPE><LENG>000005</LENG><OUTPUTLEN>000006</OUTPUTLEN>"),
};

const SOURCES: Record<string, { type: string; values: string[] }> = {
  i: { type: "TYPE i", values: ["300", "40000", "2147483647"] },
  int8: { type: "TYPE int8", values: ["300", "40000", "3000000000", "4294967297"] },
  p: { type: "TYPE p LENGTH 16 DECIMALS 0", values: ["300", "40000", "3000000000", "100000000000000000000"] },
  f: { type: "TYPE f", values: ["300.5", "40000", "3000000000", "1E20"] },
  decfloat34: { type: "TYPE decfloat34", values: ["300.5", "40000", "3000000000", "1E20"] },
};
const TARGETS: Record<string, string> = {
  i: "TYPE i", int8: "TYPE int8", b: "TYPE int1", s: "TYPE int2", p31: "TYPE p LENGTH 3 DECIMALS 1",
  n4: "TYPE n LENGTH 4", c3: "TYPE c LENGTH 3", f: "TYPE f", d16: "TYPE decfloat16",
};

const EXPECTED = `
i 300 -> i|-|[300 ]
i 300 -> int8|-|[300 ]
i 300 -> b|CO|[44 ]
i 300 -> s|-|[300 ]
i 300 -> p31|-|[300.0 ]
i 300 -> n4|-|[0300]
i 300 -> c3|-|[300]
i 300 -> f|-|[3.0000000000000000E+02]
i 300 -> d16|-|[300]
i 40000 -> i|-|[40000 ]
i 40000 -> int8|-|[40000 ]
i 40000 -> b|CO|[64 ]
i 40000 -> s|CO|[25536-]
i 40000 -> p31|AO|[5.0 ]
i 40000 -> n4|-|[0000]
i 40000 -> c3|-|[*00]
i 40000 -> f|-|[4.0000000000000000E+04]
i 40000 -> d16|-|[40000]
i 2147483647 -> i|-|[2147483647 ]
i 2147483647 -> int8|-|[2147483647 ]
i 2147483647 -> b|CO|[255 ]
i 2147483647 -> s|CO|[1-]
i 2147483647 -> p31|AO|[5.0 ]
i 2147483647 -> n4|-|[3647]
i 2147483647 -> c3|-|[*47]
i 2147483647 -> f|-|[2.1474836470000000E+09]
i 2147483647 -> d16|-|[2147483647]
int8 300 -> i|-|[300 ]
int8 300 -> int8|-|[300 ]
int8 300 -> b|CO|[44 ]
int8 300 -> s|-|[300 ]
int8 300 -> p31|-|[300.0 ]
int8 300 -> n4|-|[0300]
int8 300 -> c3|-|[300]
int8 300 -> f|-|[3.0000000000000000E+02]
int8 300 -> d16|-|[300]
int8 40000 -> i|-|[40000 ]
int8 40000 -> int8|-|[40000 ]
int8 40000 -> b|CO|[64 ]
int8 40000 -> s|CO|[25536-]
int8 40000 -> p31|AO|[5.0 ]
int8 40000 -> n4|-|[0000]
int8 40000 -> c3|-|[*00]
int8 40000 -> f|-|[4.0000000000000000E+04]
int8 40000 -> d16|-|[40000]
int8 3000000000 -> i|CO|[5 ]
int8 3000000000 -> int8|-|[3000000000 ]
int8 3000000000 -> b|CO|[0 ]
int8 3000000000 -> s|CO|[24064 ]
int8 3000000000 -> p31|AO|[5.0 ]
int8 3000000000 -> n4|-|[0000]
int8 3000000000 -> c3|-|[*00]
int8 3000000000 -> f|-|[3.0000000000000000E+09]
int8 3000000000 -> d16|-|[3000000000]
int8 4294967297 -> i|CO|[5 ]
int8 4294967297 -> int8|-|[4294967297 ]
int8 4294967297 -> b|CO|[1 ]
int8 4294967297 -> s|CO|[1 ]
int8 4294967297 -> p31|AO|[5.0 ]
int8 4294967297 -> n4|-|[7297]
int8 4294967297 -> c3|-|[*97]
int8 4294967297 -> f|-|[4.2949672970000000E+09]
int8 4294967297 -> d16|-|[4294967297]
p 300 -> i|-|[300 ]
p 300 -> int8|-|[300 ]
p 300 -> b|AO|[44 ]
p 300 -> s|-|[300 ]
p 300 -> p31|-|[300.0 ]
p 300 -> n4|-|[0300]
p 300 -> c3|-|[300]
p 300 -> f|-|[3.0000000000000000E+02]
p 300 -> d16|-|[300]
p 40000 -> i|-|[40000 ]
p 40000 -> int8|-|[40000 ]
p 40000 -> b|AO|[64 ]
p 40000 -> s|AO|[25536-]
p 40000 -> p31|AO|[5.0 ]
p 40000 -> n4|-|[0000]
p 40000 -> c3|-|[*00]
p 40000 -> f|-|[4.0000000000000000E+04]
p 40000 -> d16|-|[40000]
p 3000000000 -> i|AO|[5 ]
p 3000000000 -> int8|-|[3000000000 ]
p 3000000000 -> b|AO|[5 ]
p 3000000000 -> s|AO|[5 ]
p 3000000000 -> p31|AO|[5.0 ]
p 3000000000 -> n4|-|[0000]
p 3000000000 -> c3|-|[*00]
p 3000000000 -> f|-|[3.0000000000000000E+09]
p 3000000000 -> d16|-|[3000000000]
p 100000000000000000000 -> i|AO|[5 ]
p 100000000000000000000 -> int8|AO|[5 ]
p 100000000000000000000 -> b|AO|[5 ]
p 100000000000000000000 -> s|AO|[5 ]
p 100000000000000000000 -> p31|AO|[5.0 ]
p 100000000000000000000 -> n4|-|[0000]
p 100000000000000000000 -> c3|-|[*00]
p 100000000000000000000 -> f|-|[1.0000000000000000E+20]
p 100000000000000000000 -> d16|-|[1.000000000000000E+20]
f 300.5 -> i|-|[301 ]
f 300.5 -> int8|-|[301 ]
f 300.5 -> b|CO|[45 ]
f 300.5 -> s|-|[301 ]
f 300.5 -> p31|-|[300.5 ]
f 300.5 -> n4|-|[0301]
f 300.5 -> c3|-|[***]
f 300.5 -> f|-|[3.0050000000000000E+02]
f 300.5 -> d16|-|[300.5]
f 40000 -> i|-|[40000 ]
f 40000 -> int8|-|[40000 ]
f 40000 -> b|CO|[64 ]
f 40000 -> s|CO|[25536-]
f 40000 -> p31|CO|[5.0 ]
f 40000 -> n4|-|[0000]
f 40000 -> c3|-|[***]
f 40000 -> f|-|[4.0000000000000000E+04]
f 40000 -> d16|-|[40000]
f 3000000000 -> i|CO|[5 ]
f 3000000000 -> int8|-|[3000000000 ]
f 3000000000 -> b|CO|[0 ]
f 3000000000 -> s|CO|[0 ]
f 3000000000 -> p31|CO|[5.0 ]
f 3000000000 -> n4|-|[0000]
f 3000000000 -> c3|-|[***]
f 3000000000 -> f|-|[3.0000000000000000E+09]
f 3000000000 -> d16|-|[3000000000]
f 1E20 -> i|CO|[5 ]
f 1E20 -> int8|CO|[5 ]
f 1E20 -> b|CO|[0 ]
f 1E20 -> s|CO|[0 ]
f 1E20 -> p31|CO|[5.0 ]
f 1E20 -> n4|-|[0000]
f 1E20 -> c3|-|[***]
f 1E20 -> f|-|[1.0000000000000000E+20]
f 1E20 -> d16|-|[1.000000000000000E+20]
decfloat34 300.5 -> i|-|[301 ]
decfloat34 300.5 -> int8|-|[301 ]
decfloat34 300.5 -> b|CO|[5 ]
decfloat34 300.5 -> s|-|[301 ]
decfloat34 300.5 -> p31|-|[300.5 ]
decfloat34 300.5 -> n4|-|[0301]
decfloat34 300.5 -> c3|-|[301]
decfloat34 300.5 -> f|-|[3.0050000000000000E+02]
decfloat34 300.5 -> d16|-|[300.5]
decfloat34 40000 -> i|-|[40000 ]
decfloat34 40000 -> int8|-|[40000 ]
decfloat34 40000 -> b|CO|[5 ]
decfloat34 40000 -> s|CO|[5 ]
decfloat34 40000 -> p31|CO|[5.0 ]
decfloat34 40000 -> n4|CO|[4E+4]
decfloat34 40000 -> c3|CO|[5]
decfloat34 40000 -> f|-|[4.0000000000000000E+04]
decfloat34 40000 -> d16|-|[40000]
decfloat34 3000000000 -> i|CO|[5 ]
decfloat34 3000000000 -> int8|-|[3000000000 ]
decfloat34 3000000000 -> b|CO|[5 ]
decfloat34 3000000000 -> s|CO|[5 ]
decfloat34 3000000000 -> p31|CO|[5.0 ]
decfloat34 3000000000 -> n4|CO|[3E+9]
decfloat34 3000000000 -> c3|CO|[5]
decfloat34 3000000000 -> f|-|[3.0000000000000000E+09]
decfloat34 3000000000 -> d16|-|[3000000000]
decfloat34 1E20 -> i|CO|[5 ]
decfloat34 1E20 -> int8|CO|[5 ]
decfloat34 1E20 -> b|CO|[5 ]
decfloat34 1E20 -> s|CO|[5 ]
decfloat34 1E20 -> p31|CO|[5.0 ]
decfloat34 1E20 -> n4|CO|[0005]
decfloat34 1E20 -> c3|CO|[5]
decfloat34 1E20 -> f|-|[1.0000000000000000E+20]
decfloat34 1E20 -> d16|-|[1.000000000000000E+20]
`.trim().split("\n");

test("the result field after an exception, by calculation type and result field", () => {
  const lines = ["DATA txt TYPE string.", "DATA cls TYPE string."];
  for (const [k, s] of Object.entries(SOURCES)) {
    lines.push(`DATA a_${k} ${s.type}.`, `DATA z_${k} ${s.type}.`);
  }
  for (const [t, type] of Object.entries(TARGETS)) {
    lines.push(`DATA r_${t} ${type}.`);
  }
  const cells: string[] = [];
  for (const [k, s] of Object.entries(SOURCES)) {
    for (const v of s.values) {
      lines.push(`txt = \`${v}\`.`, `a_${k} = txt.`);
      for (const t of Object.keys(TARGETS)) {
        cells.push(`${k} ${v} -> ${t}`);
        lines.push("txt = `5`.", `r_${t} = txt.`, "cls = `-`.",
          "TRY.", `    r_${t} = a_${k} + z_${k}.`,
          "  CATCH cx_sy_conversion_overflow.", "    cls = `CO`.",
          "  CATCH cx_sy_arithmetic_overflow.", "    cls = `AO`.",
          "ENDTRY.",
          "out->write( cls ).", `out->write( r_${t} ).`);
      }
    }
  }
  const result = run("clas", classrun(lines.join("\n")), undefined, DDIC);
  assert.equal(result.failed, undefined);
  const out = (result.stdout ?? "").split("\n");
  const got = cells.map((cell, i) => `${cell}|${out[2 * i]}|[${out[2 * i + 1]}]`);
  assert.deepEqual(got, EXPECTED);
});
