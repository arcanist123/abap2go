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

## How ambiguity is resolved

Parsing is deterministic: the same input always gives the same tree. Where more than one parse is possible, the
order of the alternatives decides, not symbol information:

- `Alternative` collects the results of every branch in order, and `Combi.run` returns the first result that
  consumes all tokens.
- `StatementParser.match` takes the first statement whose matcher succeeds for the first keyword, then falls back
  to the statements without a keyword.
- The grammar uses ordered choice (`altPrio`, `optPrio`, `starPrio`) in about 1,160 places.

Much of ABAP's context sensitivity is settled earlier, in the lexer, because whitespace is part of the token type:
`b-c` and `b - c`, or `x(1)` and `x( 1 )`, produce different tokens. Name-dependent cases are mostly parsed as
generic nodes and resolved by the syntax pass. For example, built-in functions parse as `MethodCall`, and in older
SQL syntax without `@` the choice between column and host variable is made later.

What remains is a small set of token sequences with more than one valid parse, where branch order picks one. The
result is a well-formed tree, so nothing downstream can tell that it is the wrong one.

## Known cases

Two groups of abaplint issues show trees that are well-formed but can mean something else.

### Macro redefinition

`ExpandMacros` keeps one macro table per object, keyed by name. `Macros.addMacro` does nothing when the name is
already there, so the first definition wins everywhere in the object. Per the ABAP keyword documentation, a macro
is valid from its `DEFINE` onward, so a later `DEFINE` of the same name replaces it.

| Issue | State | Case |
|---|---|---|
| [#1809](https://github.com/abaplint/abaplint/issues/1809) | open | `_macro` defined in two methods; the second call expands the first definition. Maintainer: abaplint does not handle the scoping of macros |
| [#2854](https://github.com/abaplint/abaplint/issues/2854) | closed, duplicate of #1809 | `add_html` defined in two methods; the maintainer does not plan to fix it |
| [#4190](https://github.com/abaplint/abaplint/issues/4190) | open | `check_return` defined in `.clas.macros.abap` and again in a method gives a false parser_error |

In the reported examples the first body refers to variables that the second method does not have, so abaplint
reports an error. When both methods declare the same names, the wrong body is expanded without any error. This is
the clearest case of a tree that is valid in shape and wrong in meaning.

Macros add nothing for the compiler: they are text substitution, expanded before the tree is built. Their value is
that existing code uses them and should still compile.

### Internal table or database table

`DELETE`, `MODIFY`, `INSERT` and `UPDATE` each have a form for internal tables and one for database tables. Some
token sequences fit both, and only the type of the name decides which is meant. The parser has no symbol
information, so the first statement that matches wins. abaplint does not resolve these in the syntax pass. Its
answer is the rule `ambiguous_statement` (`rules/ambiguous_statement.ts`), which asks for the explicit form.

| Issue | State | Case |
|---|---|---|
| [#475](https://github.com/abaplint/abaplint/issues/475) | closed | `DELETE foo FROM bar.` is either statement depending on context; led to `ambiguous_statement` |
| [#4755](https://github.com/abaplint/abaplint/issues/4755) | open | `INSERT itab.` for a table with a header line always parses as `InsertDatabase` |
| [#3417](https://github.com/abaplint/abaplint/issues/3417) | closed | `DELETE itab FROM 2.` means different things for a `c` and an `i` operand; the explicit form is `DELETE TABLE itab FROM 2` |
| [#1855](https://github.com/abaplint/abaplint/issues/1855) | open | `MODIFY lt_foo FROM lv_foo.` reported as ambiguous |
| [#2105](https://github.com/abaplint/abaplint/issues/2105) | closed | `MODIFY SCREEN FROM wa`, a false positive of the rule |

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

For the known cases above:

- **Internal or database table** is already handled. `src/validation.ts` turns on `ambiguous_statement` and keeps
  its issue unless the statement is `DELETE name …` or `MODIFY name …` and the name decides it: a variable of
  table type is the internal table, anything else the database table. `INSERT` and `UPDATE`, including #4755, are
  refused.
- **Macro redefinition** is not handled yet. The planned check refuses an object that defines the same macro name
  more than once, counting the class macros include and the definitions in methods together. This closes the
  silent case without waiting for #1809, which would be fixed upstream only if code that abap2go must compile
  redefines macros.

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
