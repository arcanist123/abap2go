/** A refusal at build time: the construct named cannot be compiled faithfully, so no binary is produced. */
export class BuildError extends Error {
  constructor(message: string, public readonly where?: { file: string; row: number; col: number }) {
    super(where ? `${where.file}:${where.row}:${where.col}: ${message}` : message);
    this.name = "BuildError";
  }
}
