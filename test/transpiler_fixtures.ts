import * as fs from "node:fs";
import * as path from "node:path";

// The fixture files test/transpiler/*.txt: the arithmetic snippets of abaplint/transpiler's tests (MIT, see
// LICENSES/), one file per source test file. Their format is described in transpiler.test.ts.

const DIR = path.join(__dirname, "..", "..", "test", "transpiler");

export interface Snippet {
  file: string;
  name: string;
  line: number;
  fails: string | undefined;
  syntaxError: boolean;
  waits: string | undefined;
  source: string;
}

export function readSnippets(): Snippet[] {
  const snippets: Snippet[] = [];
  for (const file of fs.readdirSync(DIR).filter(f => f.endsWith(".txt")).sort()) {
    let current: Snippet | undefined;
    const lines: string[] = [];
    const finish = () => {
      if (current !== undefined) {
        current.source = lines.join("\n") + "\n";
        snippets.push(current);
      }
      lines.length = 0;
    };
    fs.readFileSync(path.join(DIR, file), "utf-8").split(/\r?\n/).forEach((text, i) => {
      if (text.startsWith("*** ")) {
        finish();
        current = { file, name: text.slice(4), line: i + 1, fails: undefined, syntaxError: false, waits: undefined, source: "" };
        return;
      }
      if (current === undefined) {
        return; // the header
      }
      let m: RegExpExecArray | null;
      if (lines.length === 0 && (m = /^\* (fails: |waits: |syntax error$)(.*)$/.exec(text)) !== null) {
        if (m[1] === "fails: ") {
          current.fails = m[2];
        } else if (m[1] === "waits: ") {
          current.waits = m[2];
        } else {
          current.syntaxError = true;
        }
      } else if (text.trim() !== "") {
        lines.push(text);
      }
    });
    finish();
  }
  return snippets;
}
