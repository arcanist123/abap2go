# abaplint as abap2go's frontend: an assessment

How `@abaplint/core` behaves as the parsing and checking frontend of an ahead-of-time compiler, and what that means
for the boundary between abaplint and abap2go. Read from the abaplint source at `33fbeb404`, 2026-11-27. Related:
[aot_for_abap.md](aot_for_abap.md), [abaplint_roadmap.md](abaplint_roadmap.md).

## What abaplint produces

abaplint's parser output is a concrete syntax tree: `StatementNode`, `ExpressionNode` and `TokenNode`, with the
original tokens kept. It is built for linting, quick fixes and downporting, so it does not produce a canonical,
desugared AST. Some normalisation does happen before abap2go sees the tree:

- **Chained statements** are split into separate statements (`StatementParser.process`); the colon is kept only as
  a back-reference on each `StatementNode`.
- **Macros** are expanded before statements are matched (`expand_macros.ts`).
- **`MOVE … TO …` and `=`** are both the `Move` statement and differ only in their child tokens.

Other variants stay distinct, for example `READ TABLE` and the table expression `itab[ … ]`.

## Ambiguity

Parsing is deterministic, and where more than one parse is possible the order of the alternatives decides, not
symbol information. The result is a well-formed tree, so nothing downstream can tell that it is the wrong one. How
this works, the known cases (internal or database table, macro redefinition, program attributes) and what abap2go
does with each are in [abaplint_ambiguous_parsing.md](abaplint_ambiguous_parsing.md).

## Types and unresolved names

The syntax pass (`5_syntax`) builds a `SpaghettiScope` with identifiers and references (`_reference.ts`).
`Source.runSyntax` computes a type for each source expression, but the type is not stored on the node. Only
references and inferred types are kept. Names that cannot be resolved become `VoidType` or `UnknownType`, and
there are about 550 uses of these in `5_syntax`. This fits abaplint's main users, linting in CI and the transpiler's
JavaScript runtime, where values are boxed and operations are resolved at run time.

## Consequences for abap2go

**Boundary.** abaplint is the stage-0 frontend. Its output is lowered into abap2go's own typed IR, where syntactic
variants collapse into uniform nodes and every expression carries a resolved static type. CST nodes and
`SpaghettiScope` do not reach code generation. Lowering refuses the build on any `Unknown` statement, `VoidType`,
`UnknownType` or unresolved reference.

For the known ambiguous cases, see [abaplint_ambiguous_parsing.md](abaplint_ambiguous_parsing.md).

**Patching abaplint.** The refusal at the boundary only catches what abaplint marks as unresolved. It cannot catch
a program that abaplint wrongly accepts, or a tree that is well-formed but means something else. Two kinds of
abaplint fixes therefore matter directly for abap2go:

1. **Parse classification**: a wrong statement or expression chosen by branch order, or a wrong precedence or
   association. Nothing downstream detects these.
2. **check_syntax gaps**: invalid ABAP that abaplint accepts. Each fix strengthens the guarantee that a program
   abaplint accepts is valid ABAP.

Keeping the type computed by `Source.runSyntax` on each node would save abap2go from deriving types again. Whether
this fits upstream is open and would be raised as an abaplint issue first.

Fixes aimed only at formatting, quick fixes or downporting have little value for abap2go.

**Replacing abaplint.** Keeping the typed IR and the lowering rules independent of abaplint's node classes leaves
room to replace the frontend later, for example with a symbol-aware parser. This is not planned work.
