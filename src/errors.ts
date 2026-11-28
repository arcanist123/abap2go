/** A place in a source file. */
export type Where = { file: string; row: number; col: number };

function located(message: string, where: Where | undefined): string {
  return where === undefined ? message : `${where.file}:${where.row}:${where.col}: ${message}`;
}

/** A refusal at build time: the construct named cannot be compiled faithfully, so no binary is produced. */
export class BuildError extends Error {
  constructor(message: string, where?: Where) {
    super(located(message, where));
    this.name = "BuildError";
  }
}

/**
 * Valid ABAP in scope that the lowering cannot compile yet (docs/aot_for_abap.md, "Four kinds of refusal"). It holds
 * every finding collected so far: lowerEach and lowerAll join those of the parts they lower.
 */
export class NotCompiled extends BuildError {
  /** One line per finding, with its position where it has one, in the order of lowering and each once. */
  readonly findings: readonly string[];

  constructor(findings: readonly string[]) {
    const unique = [...new Set(findings)];
    super(`the root uses ABAP that abap2go does not compile yet:\n${unique.join("\n")}`);
    this.name = "NotCompiled";
    this.findings = unique;
  }
}

/** One finding of "not compiled yet", to be thrown. A message of several lines, as of a type, is joined into one. */
export function notCompiled(message: string, where?: Where): NotCompiled {
  return new NotCompiled([located(message.replace(/\s*\n\s*/g, " "), where)]);
}

/**
 * A case the checks before the lowering rule out: a bug in abap2go, not a limit of it, so not a BuildError. It ends
 * the lowering at once.
 */
export class InternalError extends Error {
  constructor(message: string, where?: Where) {
    super(`internal error in abap2go: ${located(message, where)}`);
    this.name = "InternalError";
  }
}

/**
 * Lowers every item, also those after one that is not compiled yet, and then throws the findings of all of them
 * together. The items must not depend on each other's results. Any other error ends the lowering at once.
 */
export function lowerEach<A, B>(items: readonly A[], lower: (item: A) => B): B[] {
  const out: B[] = [];
  const findings: string[] = [];
  for (const item of items) {
    try {
      out.push(lower(item));
    } catch (e) {
      if (!(e instanceof NotCompiled)) {
        throw e;
      }
      findings.push(...e.findings);
    }
  }
  if (findings.length > 0) {
    throw new NotCompiled(findings);
  }
  return out;
}

/** lowerEach for parts with results of different types: their results, or the findings of all of them. */
export function lowerAll<T extends unknown[]>(...parts: { [K in keyof T]: () => T[K] }): T {
  return lowerEach(parts as (() => unknown)[], part => part()) as T;
}
