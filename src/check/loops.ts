import * as abaplint from "@abaplint/core";
import { CheckInput, issueAt } from "./input";

const { Structures, Statements } = abaplint;

/** The structures that loop: DO, WHILE, the forms of LOOP, SELECT ... ENDSELECT, WITH ... ENDWITH and PROVIDE. */
const LOOPS = [Structures.Do, Structures.While, Structures.Loop, Structures.LoopAtScreen, Structures.LoopExtract,
  Structures.Select, Structures.With, Structures.Provide];

/** CONTINUE outside a loop, which ABAP is expected to reject in every processing block. */
export function continueOutsideLoop(input: CheckInput): abaplint.Issue[] {
  const issues: abaplint.Issue[] = [];
  const walk = (node: abaplint.INode, inLoop: boolean): void => {
    if (node instanceof abaplint.Nodes.StatementNode) {
      if (!inLoop && node.get() instanceof Statements.Continue) {
        issues.push(issueAt(input, node.getFirstToken(), "CONTINUE is only possible in a loop", "continue_outside_loop"));
      }
      return;
    }
    const loop = inLoop || (node instanceof abaplint.Nodes.StructureNode && LOOPS.some(l => node.get() instanceof l));
    for (const child of node.getChildren()) {
      walk(child, loop);
    }
  };
  const structure = input.file.getStructure();
  if (structure !== undefined) {
    walk(structure, false);
  }
  return issues;
}
