# Ambiguous parsing in abaplint

Where abaplint builds a tree that is well-formed but may not be the one ABAP reads, and what abap2go does about it.
Started 2026-11-28. Decided 2026-11-28: until there is a better approach, abap2go refuses every statement that can
have more than one meaning (see "Rule for now"); the rest is open (see "Open questions"). Related:
[abaplint_frontend_assessment.md](abaplint_frontend_assessment.md), [abaplint_roadmap.md](abaplint_roadmap.md),
"Two layers".

## Why it matters

Layer 2 and the lowering both read abaplint's tree. A tree with the wrong node or the wrong context looks like any
other tree, so nothing downstream notices: the program is checked and compiled as something it is not. Per the
rules in [abaplint_roadmap.md](abaplint_roadmap.md), a wrong tree is a layer 1 defect, and a layer 2 check cannot
make up for it. The question here is how to find these cases, and what to do with each one until abaplint has a
fix, or when it never gets one.

## How abaplint resolves more than one parse

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

## Three kinds of ambiguity

1. **Branch order.** A token sequence fits two statements or expressions, and the first one in the grammar wins.
   Only the type of a name tells which is meant. Example: `DELETE foo FROM bar.`
2. **Context abaplint does not keep.** The tokens parse into one tree only, but ABAP reads them differently
   depending on something abaplint does not track. Example: a macro defined twice in an object; abaplint expands the
   first definition everywhere.
3. **Program attributes abaplint does not read.** The tree is right, but what it means, or whether it is valid,
   depends on an attribute of the program. abaplint reads neither the Unicode flag (`UCCHECK`) nor the fixed-point
   arithmetic flag (`FIXPT`) and assumes both are set.

Kind 1 is ambiguous parsing in the narrow sense. Kinds 2 and 3 are listed because they fail the same way: a
well-formed tree with a meaning nobody downstream can see.

## Known cases

### Internal table or database table (kind 1)

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

Handled: `src/validation.ts` turns on `ambiguous_statement`, and the scope pass refuses every statement it reports,
including those where the type of the name would decide (`test/scope/ambiguous.test.ts`). The explicit forms (`DELETE TABLE
itab …`, `DELETE FROM dbtab …`) build. Until 2026-11-28 a filter taken from abaplint/transpiler let `DELETE name …`
and `MODIFY name …` through when the name decided it; it was dropped, as it settled only which table is meant, not
the reading of the operand in #3417. `INSERT itab.` (#4755) is not reported by the rule and stays open.

### Macro redefinition (kind 2)

`ExpandMacros` keeps one macro table per object, keyed by name. `Macros.addMacro` does nothing when the name is
already there, so the first definition wins everywhere in the object. Per the ABAP keyword documentation, a macro
is valid from its `DEFINE` onward, so a later `DEFINE` of the same name replaces it.

| Issue | State | Case |
|---|---|---|
| [#1809](https://github.com/abaplint/abaplint/issues/1809) | open | `_macro` defined in two methods; the second call expands the first definition. Maintainer: abaplint does not handle the scoping of macros |
| [#2854](https://github.com/abaplint/abaplint/issues/2854) | closed, duplicate of #1809 | `add_html` defined in two methods; the maintainer does not plan to fix it |
| [#4190](https://github.com/abaplint/abaplint/issues/4190) | open | `check_return` defined in `.clas.macros.abap` and again in a method gives a false parser_error |

In the reported examples the first body refers to variables that the second method does not have, so abaplint
reports an error. When both methods declare the same names, the wrong body is expanded without any error.

Not handled yet. To do: refuse an object that defines the same macro name more than once, counting the class
macros include and the definitions in methods together.

### Unicode flag (kind 3)

abaplint's grammar accepts old and modern forms together, and its syntax check assumes Unicode. abap2go refuses a
program without `UCCHECK` in the scope pass (done, see "Program attributes" below) and checks the non-Unicode-only
forms in layer 2 ([abaplint_roadmap.md](abaplint_roadmap.md), "Non-Unicode-only syntax").

This does not depend on kind 1. The forms found so far are of two sorts, and neither is a choice between two
parses:
- a missing addition, visible in the tree: `OPEN DATASET f.` without `FOR …` or `IN … MODE`, `DESCRIBE FIELD …
  LENGTH` and `DESCRIBE DISTANCE` without `IN … MODE`. The matchers in `open_dataset.ts` and `describe.ts` keep the
  additions as their own tokens, so a check sees whether they are there
- a rule on types: an operand of a string or byte statement of the wrong kind, an offset/length that reaches past the
  character-like start of a structure. The tree is the same in both kinds of program; the check needs the type of the
  operand, which layer 2 has

It would depend on kind 1 only if the same tokens were read as a different statement in a Unicode program than in a
non-Unicode one. No such case is known; the inventory below would show one.

### Fixed-point arithmetic (kind 3)

Per the ABAP keyword documentation, without the fixed-point arithmetic attribute the decimal places of a `p` field
are ignored in calculations. abaplint does not read `FIXPT`, and the compiler compiles every
program as if it were set. As for Unicode: abap2go reads the flag and refuses a program without it (done, see below).

### Program attributes

`src/scope/attributes.ts` reads both flags from the abapGit XML, which leaves out a field that is not set:

| Object | Element | Unicode flag | Fixed-point flag |
|---|---|---|---|
| program | `PROGDIR` | `UCCHECK` | `FIXPT` |
| function group | `PROGDIR` of the main program | `UCCHECK` | `FIXPT` |
| class | `VSEOCLASS` | `UNICODE` | `FIXPT` |
| interface | `VSEOINTERF` | `UNICODE` | none |

- The Unicode flag holds the ABAP language version in modern ABAP (`X`, or a digit for a restricted version such as
  ABAP for Cloud Development). Every version is taken to be a Unicode one, so any value passes. `FIXPT` has to be `X`.
- An include program (`SUBC` `I`) is expected to take the attributes of the program that includes it, so its own flags
  are not read.
- An object without the XML file that holds its flags (of a function group, that of its main program) is taken to have
  both set (decided 2026-11-28): open-abap-core has no XML file for most of its classes. An XML file that lacks the
  element or a flag is refused.

## Rule for now

A statement that can have more than one meaning is refused, with a finding that asks for the explicit form. The
refusal is the scope pass (`src/scope/`, see [aot_for_abap.md](aot_for_abap.md), "Four kinds of refusal"): the code
is valid ABAP, so it is reported as not supported, not as a syntax error. This holds for every kind above:
- kind 1: every `ambiguous_statement` finding stops the build (done)
- kind 2: an object that defines the same macro name more than once is refused (to do)
- kind 3: a program without `UCCHECK` or without `FIXPT` is refused (done, `test/scope/attributes.test.ts`)

A case moves to one of the other answers below only when code that abap2go must compile needs it.

## What to do with a case

For each case, one of:

1. **Fix the parse upstream** (layer 1, as every wrong tree). Fits when the grammar picks the wrong branch whatever
   the context, so the fix is a reordering or a narrower matcher.
2. **Resolve it in abap2go from scopes and types**, as for `DELETE` and `MODIFY`. Fits when abaplint's syntax pass
   knows the name but does not change the tree. Only where the compiler needs the statement; it is a correction of
   layer 1 in abap2go, so it should also be offered upstream.
3. **Refuse it.** The rule for now: the build stops with a finding that names the ambiguity and asks for the explicit form.
   Costs nothing, is always safe, and leaves the case open until code that abap2go must compile needs it.
4. **Read the context abaplint drops** (program attributes, macro definitions) and refuse what abap2go does not
   support. This is the answer for kinds 2 and 3.

## Open questions

- **Inventory of kind 1.** Only the table statements are known, because `ambiguous_statement` names them. A
  mechanical search could find the rest: run every statement matcher, not only the first that succeeds, over a corpus
  (abaplint's own test sources, the example programs) and list the token sequences that more than one statement
  accepts. The same for expressions is harder, as `Combi` stops at the first full match; a debug mode that collects
  every full match would be needed, and could be offered upstream as a test helper.
- **Is the inventory worth it now?** The alternative is to wait until a case turns up in code abap2go compiles.
  Kind 1 fails silently, so waiting means a case is found by a wrong result at run time, not by a refusal.
- **Upstream.** Would the maintainer take a test that fails when two statements match the same tokens, with an
  allow-list for the known ones? It would keep new overlaps out of the grammar.
- **Other attributes.** Are there more program attributes or settings, besides `UCCHECK` and `FIXPT`, that change what
  a well-formed tree means?
