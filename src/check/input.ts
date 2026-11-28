import * as abaplint from "@abaplint/core";

/** What a check sees of one source file: its object, the file and the scopes of the object's syntax run. */
export interface CheckInput {
  readonly obj: abaplint.ABAPObject;
  readonly file: abaplint.ABAPFile;
  readonly spaghetti: abaplint.ISpaghettiScope;
}

/** A check: the findings in one file, as errors in abaplint's Issue format. */
export type Check = (input: CheckInput) => abaplint.Issue[];

/** An error of layer 2 at a token, under the key of its check. */
export function issueAt(input: CheckInput, token: abaplint.Token, message: string, key: string): abaplint.Issue {
  return abaplint.Issue.atToken(input.file, token, message, key, abaplint.Severity.Error);
}

/** Every expression node in the statements of the file, depth first. */
export function* expressions(file: abaplint.ABAPFile): Generator<abaplint.Nodes.ExpressionNode> {
  const walk = function* (node: abaplint.INode): Generator<abaplint.Nodes.ExpressionNode> {
    for (const child of node.getChildren()) {
      if (child instanceof abaplint.Nodes.ExpressionNode) {
        yield child;
        yield* walk(child);
      }
    }
  };
  for (const statement of file.getStatements()) {
    yield* walk(statement);
  }
}
