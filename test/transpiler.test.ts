import { test } from "node:test";
import * as assert from "node:assert/strict";
import { dtel, run } from "./harness";
import { readSnippets } from "./transpiler_fixtures";

// The arithmetic snippets of abaplint/transpiler's tests (test/transpiler/*.txt, MIT, see LICENSES/), each compiled
// as a report and run end to end. A file holds the snippets of one source test file:
//
//   *** <name of the source test>
//   * <status lines, if any>
//   <ABAP source>
//
// Without a status line the snippet must run to its end: every ASSERT holds and nothing is output. Status lines:
//   * fails: <name>     the program ends with this runtime error or uncaught exception class
//   * syntax error      the snippet is not valid ABAP, so the compiler must refuse it
//   * waits: <reason>   a statement or operand is not compiled yet; the snippet runs as a todo, so it shows when
//                       it passes, without failing the suite

// INT1 and INT2 as data elements of their built-in types
const DDIC = {
  ...dtel("INT1", "<DATATYPE>INT1</DATATYPE><LENG>000003</LENG><OUTPUTLEN>000003</OUTPUTLEN>"),
  ...dtel("INT2", "<DATATYPE>INT2</DATATYPE><LENG>000005</LENG><OUTPUTLEN>000006</OUTPUTLEN>"),
};

const snippets = readSnippets();

test("the snippet names are unique per file", () => {
  const seen = new Set<string>();
  for (const s of snippets) {
    assert.ok(!seen.has(`${s.file}/${s.name}`), `${s.file}: ${s.name} twice`);
    seen.add(`${s.file}/${s.name}`);
  }
});

for (const s of snippets) {
  test(`${s.file.replace(/\.txt$/, "")}: ${s.name}`, { todo: s.waits }, () => {
    const where = `test/transpiler/${s.file}:${s.line}`;
    const result = run("prog", s.source, undefined, DDIC);
    if (s.syntaxError) {
      assert.ok(result.refused !== undefined, `${where}: built, but the snippet is not valid ABAP`);
      return;
    }
    assert.equal(result.refused, undefined, `${where}: refused`);
    if (s.fails !== undefined) {
      assert.match(result.failed ?? "", new RegExp(`\\b${s.fails}\\b`), `${where}: expected ${s.fails}`);
    } else {
      assert.equal(result.failed, undefined, `${where}: failed`);
    }
    assert.equal(result.stdout, "", `${where}: output`);
  });
}
