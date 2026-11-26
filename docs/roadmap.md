# abap2go roadmap

Issue numbers: `abaplint#` = abaplint/abaplint, `open-abap-core#` = open-abap/open-abap-core; a bare number
belongs to the repository of its section.

## Purpose

**The goal is an AOT compiler for ABAP:** ABAP compiled ahead of time into standalone executables that run at a
speed comparable to Go, with no ABAP application server and no JS runtime (a database, embedded or external, is
allowed). The design is [aot_for_abap.md](aot_for_abap.md). Work on abaplint and open-abap-core is listed here
to the extent that it moves the AOT compiler forward.

Priority, when choosing what to pick up next:
1. **the specification of ABAP's rule tables** (the critical path, below): runtime-neutral, SAP is the reference
2. **abaplint** (parser, check_syntax): the compiler's types come from abaplint, so a mistyped expression becomes
   wrong native code. Within it, valid ABAP that abaplint mistypes or fails to parse comes before invalid ABAP that
   abaplint accepts, because the compiler's input is code that already activates
3. **open-abap-core**: its pure-ABAP classes (RTTI, XML, JSON, HTTP, conversions, ...) are compiled into AOT
   binaries as they are; its kernel and JS parts do not carry over

- ABAP behaviour is the reference, not abaplint's rules. **Classic modern ABAP is the reference**: the current
  on-premise language with its modern syntax (7.40 and later), not ABAP Cloud
- the expected behaviour is worked out (keyword documentation) and written down as tests before it goes into code
  or a PR
- nothing that would stop ABAP from compiling ahead of time: nothing that needs a JS host or a compiler at run time
- lint rules are out of scope: only the parser and check_syntax count
- a gap in abaplint or open-abap-core that the compiler runs into, within the scope it compiles, is fixed right
  away: offered upstream as a PR, and carried in `patches/` until an abaplint release has it. It goes before the other work items
  of that repository

This file is the source of status for abap2go and the work it needs in other repositories.

## The compiler (status 2026-11-26)

TypeScript on `@abaplint/core`, emitting Go (`src/`, runtime in `runtime/go`); `npm test` builds and runs small
programs end to end and runs the Go runtime's tests. No CI yet.

Done:
- hello world, PR #1 (`a6f3f83`): an abapGit package is syntax-checked as v758, one root is lowered to a
  plain-data IR and built into one native executable; anything else is refused at build time
  - roots: a report (`WRITE [/] '<literal>'`, `START-OF-SELECTION` only) or a class implementing
    `if_oo_adt_classrun` (`out->write( )` of literals)
  - hosting follows open-steamgate (see the decision in [aot_for_abap.md](aot_for_abap.md)): open-abap-gui's
    list layout (`ZCL_GG_HOST_LIST`, ported from the MIT upstream open-abap/open-abap-gui; the oisee fork's LICENSE
    only says "todo"), the console as open-steamgate's `ZCL_OSD_CLASSRUN_OUT`, the build layout of osabap
  - output streams: a list line goes to stdout as soon as it is finished, a console write at once
- the conversion table (2026-11-24): the value model for all 16 elementary kinds (native values: `int32`, `int64`,
  strings, `float64`, a 128-bit unscaled integer for `p`, a decimal coefficient and exponent for decfloat) and
  every cell of the conversion matrix in the runtime (`abap.Convert`), specified in
  [spec/conversion.md](spec/conversion.md) with 11,716 test cases
  - compiled: `DATA x TYPE <elementary> [VALUE literal]`, `x = literal | variable`, `out->write( variable )`; an
    uncaught exception ends the program with a runtime error on stderr and exit code 1
- `WRITE x` for all 16 elementary kinds (2026-11-24): a variable or number literal is formatted by the rules of
  [spec/write.md](spec/write.md) (`abap.Format`, its own rules per kind, not the conversion to string) with the
  session's user settings, and goes onto the list with its full output length
  - user settings per session: the default settings, or a user from the user setup file (`--user-setup <file>
    [--user <name>]`, JSON, the codes of the user master record); the database override comes with the database
    port
  - `WRITE` of a text literal ending in blanks and `WRITE ''` compile: a literal has its full length
  - open-steamgate's ANOMALY-2026-10-17-list-integer-width is a test case: `i` in 11 columns
  - `WRITE` of a variable typed with a data element formats it as its built-in type when the data element (or its
    domain) has the built-in output length and no conversion exit; any other dictionary or local type (`sy-datum`,
    `LIKE`, `TYPES`, table fields) is refused for `WRITE`, since its own output length changes the output
- the compiler runs on an abaplint release plus a patch (2026-11-26, before that a vendored fork build since
  2026-11-24): `@abaplint/core` is pinned to an upstream release, and `patch-package` applies
  `patches/@abaplint+core+<version>.patch` on `npm install`. The patch holds the abap2go PRs to abaplint that the
  release does not contain yet, open or merged but unreleased (listed in `patches/abaplint-prs.txt`);
  `scripts/abaplint-patch.sh` regenerates it, and each PR drops out once a release has it. Fixes carried this way:
  - `WRITE` of a utclong (abaplint#4700, PR abaplint#4701), which now compiles; released in 2.120.119, so no
    longer in the patch
  - INT1 and INT2 keep their size (abaplint#4630, PR abaplint#4631): `b` and `s` are declared through data
    elements, and moves, `WRITE` and `out->write( )` follow their rules
- arithmetic (2026-11-24): the calculation type table in the runtime (`abap.Calculate`, `calc.go`): the calculation
  type from the operands and the result field (generic operands with their run-time type), `+ - * / DIV MOD **`,
  the sign, `abs`, `sqrt` and `ipow` in `i`, `int8`, `p` (31 significant digits, the whole expression again with
  63), `f` and `decfloat34` (with its scale), the overflow, division and domain exceptions, the result moved into
  its field (c and string targets of `p` with their own text rules), inline declarations and `EXACT`; every cell of
  `calculation.tsv` passes
  - compiled: `result = expression.` and `+= -= *= /=` with variables, literals (a number beyond `i` is a `p`),
    parentheses and the three functions, as an `abap.Expr` tree
  - signs and priorities (2026-11-25): `**`, then the sign (`-`, `+`, repeated), then `* / DIV MOD`, then `+ -`;
    `- 7` is a sign, `-7` one operand; a lone `+ a` is an arithmetic expression. The cells of
    `calculation_contexts.tsv` the compiler supports run end to end (`test/contexts.test.ts`)
- text as UTF-16 (2026-11-25, decision "Storage" in [aot_for_abap.md](aot_for_abap.md)): `c`, `n`, `d`, `t` and
  `string` hold UTF-16 code units, big-endian, in a Go `string` (`runtime/go/abap/text.go`); moves between text
  kinds, text comparisons and the list work on code units, the rules for numbers, dates and times read and write
  UTF-8 at the entry points (with an ASCII fast path), and UTF-8 is used where text leaves the program (console,
  list). Literals are emitted as code units; test cases outside the Basic Multilingual Plane: lengths, a `c` field
  cut between the two code units of a character, order against U+E000 and U+FFFD, list columns
- `int8` beyond the range of `i` into `d` and `t` (2026-11-25, reopened cell settled): `d` takes the lower four
  bytes as an `i`, `t` the whole value modulo 86400; 14 more cells in `conversion.tsv`
- `strlen( )` and offset/length access (2026-11-25, `runtime/go/abap/substring.go`, `test/substring.test.ts`):
  both count UTF-16 code units (bytes for x and xstring), so a character outside the Basic Multilingual Plane
  counts two and a subfield can cut between its two code units
  - `strlen( )` of c, n, d and t without trailing blanks, of string with them, as an operand of an arithmetic
    expression; any other argument type is a syntax error
  - `dobj+off(len)`, `dobj+off`, `dobj(len)` with integers or variables, on c, n, d, t, string, x and xstring, as a
    source (moves, arithmetic, `WRITE`, `out->write( )`) and on the flat types as a target (moves, calculations,
    `+= …`). The subfield of c is a c, of n, d and t an n, of x an x, of string and xstring the same type; its
    type is given at run time (`abap.Substring`), since a variable offset or length decides its length
  - a subfield of a flat field lies within it and is at least one character long, a subfield of a string or
    xstring lies within its current length and may be empty; otherwise `CX_SY_RANGE_OUT_OF_BOUNDS`. Static bounds
    outside a flat field, subfields of other types and subfields of strings as targets are syntax errors and are
    refused at build time
- the input is checked with abaplint's rules that stand in for ABAP syntax errors (`src/validation.ts`,
  `errorNamespace: "."`): an unknown type is an error (`unknown_types`), not a void type, and so are a method not
  implemented, mismatched END OF names and the other rules that stand in for ABAP syntax errors
- `ASSERT` (2026-11-25, `src/lower_cond.ts`): a condition as for `IF` (below); when it does not hold, the program
  ends with the runtime error `ASSERTION_FAILED`. A number literal beyond the range of `i` is a `p` everywhere now,
  also in moves and `VALUE`
- control flow (2026-11-25, `src/lower_block.ts`, `test/control_flow.test.ts`): `IF`/`ELSEIF`/`ELSE`, `CASE`/`WHEN
  … OR …`/`WHEN OTHERS` (each `WHEN` the comparison `operand = value`), `DO`, `DO n TIMES` (n converted to `i` once,
  before the first pass), `WHILE`, and in loops `EXIT`, `CONTINUE` and `CHECK`; `sy-index` as an operand
  (`session.Sy.Index`): the number of the pass, set before a `WHILE` condition is evaluated, and set back to its
  value before the loop when the loop ends
  - conditions: comparisons with `= <> < > <= >=` (all forms) of literals, variables, subfields and `sy-index` on
    `abap.Compare`; arithmetic expressions as operands, with one calculation type for all operands of the comparison
    (`abap.CompareCalculated`); `[NOT] BETWEEN`; `NOT`, `AND`, `OR`, `EQUIV` and parentheses with their priorities
    and short-circuit evaluation (a subfield is computed only when its comparison is evaluated). 338 of the 404 cells
    of `comparison_expr.tsv` run end to end (`test/comparison_expr.test.ts`); the others wait for `IS INITIAL`,
    `CONV` and built-in functions as single operands
  - `NOT` repeated any number of times (2026-11-25, abaplint #4714, in the abaplint patch): an even number cancels out
  - `DATA` is not executable: every variable of a processing block exists from its start with its start value, also
    one declared in a loop or a branch
  - refused: `DO … VARYING`, `WHILE … VARY`, an arithmetic expression as the operand of `CASE`, `WHEN` or
    `DO … TIMES`, `CASE` without `WHEN`, a lone built-in function as a comparison operand, comparisons of kinds
    without a comparison type (`d` with `t`, `utclong` with anything but `c`, `string` and `utclong`), a non-numeric
    single operand against an arithmetic expression, the other predicates (`IS`, `IN`, `CO`, …), `WRITE sy-index`
    (the output length of its data element)
- the arithmetic tests of abaplint/transpiler as end-to-end fixtures (2026-11-25, `test/transpiler/*.txt`, run by
  `test/transpiler.test.ts`, MIT, see `NOTICE`): the 157 ABAP snippets of `test/operators/arithmetics*.ts`,
  `mod.ts`, `test/types/*_operations.ts`, `integer8_calculation_type.ts` and `conversion_no_number.ts`, one
  fixture file per source file, each snippet under the name of its source test
  - rewritten to `ASSERT` form: what a snippet wrote is asserted instead, with the expected value worked out again
    for ABAP. Some differ from the source tests: `int8 / int8` into `f` and into `p LENGTH 8 DECIMALS 1` is 3.5,
    not 3, since the calculation type is that of the result field
  - six snippets move a literal ABAP is expected to reject as a syntax error, since it does not fit the type: `-1`
    into `x LENGTH 1`, `'abc'`, `'1E3'` and `'2.5'` into `i`, `int8` and `f`, `'x10'` as a key of an `n` component.
    Their fixtures move the literal through a text variable, so the conversion at run time is still tested; the
    snippet as written is kept as a case that must be refused
  - a snippet runs to its end (every `ASSERT` holds), or ends with the runtime error or exception its status line
    names (`int` overflow, `100 MOD 0`). 94 of 163 cases run end to end (79 before control flow, 93 before `TRY`);
    the other 69 are marked as waiting for what the compiler refuses first: string templates 22, structures and
    internal tables 11, `ADD`/`SUBTRACT`/`MULTIPLY`/`DIVIDE` 6, `sign( )` and `exp( )` 6, the build-time check of
    literals 6, `abap_true` and `abap_false` 5, `IS INITIAL` 4, `CONSTANTS` 3, `CLEAR` 2, field symbols 2, `CO` 1,
    `&&` 1. A waiting case runs as a todo, so it shows once it passes
  - no compiled snippet gave a value other than the expected one
- leaving the processing block (2026-11-26, `src/lower_block.ts`, `test/control_flow.test.ts`): `RETURN` anywhere,
  and outside a loop `EXIT` and `CHECK <condition>`. In a method the method ends; in a report the list is still
  written
  - a report can have several `START-OF-SELECTION` blocks, the statements before the first one being a block of
    their own. They run in order and each starts a new line of the list (before, they ran as one block, without that
    line break). A `CHECK` outside a loop whose condition is false leaves its block only, so the next one runs;
    `RETURN` and `EXIT` skip the blocks still to run. The same difference is expected to matter for
    `END-OF-SELECTION` once it is compiled: per the keyword documentation, no further reporting event is raised
    after `RETURN` or `EXIT`, while `CHECK` ends the block in the regular way
  - refused: `CONTINUE` outside a loop (a syntax error), `RETURN` with an operand (functional methods are not
    compiled), `EXIT` with an addition, `CHECK` without a condition
- `TRY … CATCH … CLEANUP … ENDTRY` and `RETRY` (2026-11-26, `abap.Session.Try` in `runtime/go/abap/try.go`,
  `test/try.test.ts`): a `CATCH` clause catches the classes it names and their subclasses, the first matching clause
  wins. As ABAP decides it where the exception is raised, an exception no `TRY` catches ends the program without
  running any `CLEANUP` block; one caught further out runs the `CLEANUP` blocks of the `TRY`s it leaves, innermost
  first, before the `CATCH` block. An exception raised in a `CATCH` block goes to the `TRY`s further out (its own
  `CLEANUP` does not run), and one that leaves a `CLEANUP` block ends the program. `sy-index` is set back when an
  exception or `RETRY` leaves a loop. `EXIT`, `CONTINUE` and `CHECK` leave a `TRY` for a loop around it, and
  `RETURN`, `EXIT` and `CHECK` outside a loop for the end of the processing block, without running a `CLEANUP` block
  - the target after an exception: `=` and `result = expression` store the value the exception leaves (see "The
    target after an exception" in [spec/conversion.md](spec/conversion.md)) before raising it; 171 cells of results
    of every calculation type that do not fit integer, `p`, `n`, `c`, `f` and `decfloat16` result fields run end
    to end (`test/result_field.test.ts`). An `int8` result keeps an `i` result field, unlike the conversion of an
    `int8` data object
  - the exception classes the runtime raises are global classes of the built-in library (`lib/`), with their
    superclasses up to `CX_ROOT`; a `CATCH` of another class is refused as unknown
  - special values: an exception that would leave `+Inf`, `-Inf` or NaN in an `f` field, or an infinity in a
    `decfloat16` field, is a runtime error naming the gap when a `TRY` could read the field (an exception to the
    guiding principle, see [aot_for_abap.md](aot_for_abap.md)); uncaught, it ends the program as the exception does
  - refused: `CATCH … INTO` and `CLEANUP INTO` (object references are not compiled), `CATCH BEFORE UNWIND`, and,
    as ABAP syntax errors, `RETRY` outside a `CATCH` block, `RETURN`, `EXIT`, `CONTINUE` and `CHECK` leaving a `CLEANUP` block,
    a `TRY` without `CATCH` or `CLEANUP`, a `CATCH` of a class not derived from `CX_ROOT` (abaplint does not report
    the last three yet: #4723, #4724, #4725); constants and built-in
    data objects (`abap_true`) as operands

Next:
- [ ] control flow, the rest: `IS INITIAL` and the other predicates once the comparison table has them, built-in
  functions and `CONV` as single comparison operands (operands with the type of their result), `CASE` and
  `DO … TIMES` with expressions, `WRITE sy-index` with the output length of its data element
- [ ] static operands resolved at build time (decided 2026-11-25, [aot_for_abap.md](aot_for_abap.md), "Static
  operands: the cell is chosen at build time, after control flow is compiled"), **after `ASSERT` and control flow
  above**: each conversion cell a Go function that `abap.Convert` dispatches to and the compiler calls directly; the
  calculation type fixed at build time, `i`, `int8` and `f` as native Go operations with overflow checks, `p` and
  `decfloat34` as direct calls; comparison types chosen at build time; every TSV cell run on both paths
  - a literal that does not convert to its static target is a syntax error, refused
    at build time; the six "as written" transpiler fixtures are its test cases
- [ ] the rest of `calculation_contexts.tsv` as its statements are compiled: inline declarations, templates, `CONV`,
  `EXACT`, `ADD` and the others, the result field after an exception (with `TRY`). The expression parser of
  `calculation_test.go` still attaches a leading `-` to its operand; fix it if it is to run these cells too
- [ ] arithmetic beyond `result = expression`: inline declarations (`DATA(r) = …`, the declared type of
  [spec/calculation.md](spec/calculation.md)), `EXACT` and `CONV`, expressions as operands of `WRITE` and
  `out->write( )`
- [ ] `WRITE` of dictionary types with their own output length (`sy-datum` in 10 characters with separators),
  conversion exits, table fields
- [ ] the manifest of conversion exits per root (decided 2026-11-25, [aot_for_abap.md](aot_for_abap.md),
  "Conversion exits: static, plus a manifest per root"): its format and where the root declares it, the listed
  exits compiled with their closure, an entry outside the world refused at build time, and the run-time error for
  an exit on an unbounded operand that was neither reached nor listed
- [ ] port the rest of the list processor as the compiler needs it: positions and lengths, `NO-GAP`,
  justification, `ULINE`, `SKIP`, `NEW-LINE`, then `TOP-OF-PAGE`; open-steamgate's `tools/gogen/testdata-list`
  and its ANORMALIES list entries are the test cases
- [ ] `out->write( )` of structures and tables (open-steamgate's format: a structure as one
  `field: value, field: value` line, a table as a header row and tab-separated rows)
- [ ] the cells of `conversion_target.tsv` and `conversion_edges.tsv` end to end through `TRY … CATCH`, as the
  result-field grid of `test/result_field.test.ts` runs; `CATCH … INTO` once object references are compiled
- [ ] CI (Node and Go, `npm test`)

## Critical path: the specification of ABAP's rule tables

[aot_for_abap.md](aot_for_abap.md) decided that the generic run-time rules must be **complete from the start**:
an operand of `TYPE any` can hold any DDIC type at run time (dynamic SQL, `CREATE DATA … TYPE (n)`), and a missing
rule cannot be refused at run time, so any gap is a wrong assignment. The generic path, and with it dynamic SQL and
RTTI, cannot ship before the rules are complete.

**What is on the critical path is the specification, not any implementation.** For every cell: the expected
behaviour (including the exception SAP raises), its source in the keyword documentation, and a test snippet. It is
runtime-neutral: an AOT runtime implements it once in its own code. Expected behaviour is worked out from the
keyword documentation and written down as test cases; SAP is the reference, no runtime is.

The tables, over the elementary kinds `c n d t x string xstring i int8 b s p f decfloat16 decfloat34 utclong`
(structures and tables follow component rules and fragment views):

| Table | Covers |
|---|---|
| conversion (about 16 × 16) | `=`, `MOVE`, parameter passing, `MOVE-CORRESPONDING`, table keys |
| comparison | `=`, `<`, `IS INITIAL`, `READ … WITH KEY`, `SORT` |
| calculation type | arithmetic, `COLLECT`, `DIV` / `MOD` / `**`, overflow classes |
| output formatting | `WRITE`, string templates, `DESCRIBE … OUTPUT-LENGTH` |

Done:
- `WRITE` of the output formatting table, [spec/write.md](spec/write.md) (2026-11-24): output length and rule per
  kind, the user settings it depends on (decimal notation, date format), and 916 test cases
  (`runtime/go/abap/testdata/write.tsv`)
- the conversion table, [spec/conversion.md](spec/conversion.md): the 16 × 16 matrix, a rule per cell with its
  exceptions and its keyword documentation section, all kinds including c, string, x, xstring, d, t and utclong,
  and 11,716 test cases (`runtime/go/abap/testdata/conversion*.tsv`), each one a snippet
- the calculation type table, [spec/calculation.md](spec/calculation.md) (2026-11-24): which type an arithmetic
  expression calculates in (operands and result field, `**`, functions, generic operands, inline declarations),
  the rules of `+ - * / DIV MOD **` and `ipow( )` in `i`, `int8`, `p` (31, then 63 significant digits), `f` and
  `decfloat34` (scale, signed zeros), division by zero, the overflow classes, the result moved into its target
  (a `p` result into `c` and `string`, with the scale of an exact `p` product and of `ipow( )`), assignment
  operators and `EXACT`; 3,648 test cases (`runtime/go/abap/testdata/calculation.tsv`). Open: `COLLECT`, method and
  function module parameters
- the comparison table, [spec/comparison.md](spec/comparison.md) (2026-11-24): the comparison type of every pair of
  elementary kinds, the rules per comparison type (text rounded to an integer and compared without a range, text in
  `p` rounded to its decimals, `f` through its 17-digit form against `decfloat34`, padding and prefixes, the length
  rules of `d` and `t` against text), the conversion errors that end the program (`CONVT_NO_NUMBER`,
  `CONVT_OVERFLOW`, `CONVT_NO_DATETIME`, `COMPARE_NOT_SUPPORTED`), arithmetic expressions as operands (one calculation
  type for both sides, also the comparison type), `NOT`/`AND`/`OR`/`EQUIV` with left-to-right short-circuit
  evaluation, literals and the syntax errors; 26,244 grid cells (`comparison.tsv`), 3,000 held-out random cells
  (`comparison_random.tsv`) and 404 logical-expression cells (`comparison_expr.tsv`). Implemented in the runtime as
  `abap.Compare` (`compare.go`), which passes the grid and the held-out cells
- precedence and overflow in the calculation type table (2026-11-24): `**` binds before the sign, the sign before
  `* / DIV MOD`, a negative literal is one operand; overflow raises the same exception in assignments, assignment
  operators, `ADD`/`SUBTRACT`/`MULTIPLY`/`DIVIDE`, `CONV`/`EXACT` (whose type takes part in the calculation type),
  embedded expressions of string templates (operands only) and comparisons, and an arithmetic exception leaves the
  result field unchanged; 699 cells (`calculation_contexts.tsv`), 380 of them checked against a precedence model
- the target after an exception (2026-11-25), [spec/conversion.md](spec/conversion.md), "The target after an
  exception": `CX_SY_CONVERSION_OVERFLOW` and `CX_SY_CONVERSION_NO_NUMBER` leave a value in some targets (the lower
  bytes of an integer in b, s and, from int8, i; the sign or 0 from text; the number prefix, `±Inf` or NaN in f;
  the fitted text of a decfloat in n), every other cell keeps its target. 2,217 cells over all sources and targets
  (`conversion_target.tsv`) and 2,102 more cells at the edges of the integer, p and n targets
  (`conversion_edges.tsv`); `abap.Convert` and `abap.Calculate` return the value with the exception

What the tables have to settle, by example: the issues raised in abaplint/transpiler from #2019 on are one-off
findings of exactly these rules. Of 73, 57 fall inside the four tables or the structure rules (conversion 17,
calculation type and precision 11, overflow and range 8, structure moves 7, comparison 6, output formatting 6,
precedence 2). The tables are to settle such cases systematically, as grids of cells (every operator, kind, boundary
value and context), not one issue at a time; the snippets of those issues and PRs are a source of cells, and a cell
whose expected behaviour contradicts a spec is reopened there.

Next:
- [ ] special values left after an exception: what `WRITE`, the conversions, comparisons and arithmetic do with
  an f holding `+Inf`, `-Inf` or NaN and a decfloat16 holding an infinity; the runtime keeps a decfloat16 target
  instead of storing an infinity until its decfloat value can hold one. `TRY` came first (2026-11-26), so where a
  `TRY` could read such a target the program ends with the run-time error `SPECIAL_VALUE_NOT_SUPPORTED`, listed
  as an exception in [aot_for_abap.md](aot_for_abap.md); closing this gap removes it
- [ ] the rest of the comparison table: the string and byte operators (`CO`, `CN`, `CA`, `NA`, `CS`, `NS`, `CP`,
  `NP`, `BYTE-…`, `O`, `Z`, `M`), predicate expressions (`IS INITIAL`, `IS ASSIGNED`, `IN` ranges), structures,
  internal tables and references, and the comparisons inside statements (`READ TABLE … WITH KEY`, table keys,
  `SORT … AS TEXT`, `DELETE ADJACENT DUPLICATES`)
- [ ] structure rules of the conversion table: `MOVE-CORRESPONDING`, `CORRESPONDING`; flat structures with
  non-matching fragment views are refused at build time for now (decision "Storage", 2026-11-25), like every
  operation that depends on ABAP's memory layout
- [ ] the rest of the output formatting table: string templates (`|{ x }|`, with their own rules, including the
  styles for decfloat), `DESCRIBE … OUTPUT-LENGTH`, then the `WRITE` additions (`DECIMALS`, `NO-GROUPING`, date
  masks, `CURRENCY`, …) and `WRITE … TO`
- [ ] the rest of the calculation type table: `COLLECT`, arithmetic expressions as actual parameters, the other
  built-in numeric functions


## Data-dependent differences

Found in the review of 2026-11-25 ([aot_for_abap.md](aot_for_abap.md), "Data-dependent differences"): behaviour
that depends on data or the run-time environment, so the build cannot refuse it. Each is a bug under the guiding
principle until fixed, made a static input or listed as an exception. Text as UTF-16 (under "Next" above) was the
first of this kind.

- [ ] `**` on `f`: work out expected values over a sweep of inputs and compare `math.Pow`; on a difference,
  a correctly rounded `pow` or one that matches ABAP's. The same for `exp`, `log` and the trigonometric functions
  before they are compiled
- [ ] list columns by display width: East Asian full-width characters take two columns in the list processor,
  with test cases
- [x] decide unspecified but deterministic behaviour (2026-11-25): case by case, the fastest implementation
  first, elementary types always exact. `SORT` without `STABLE` uses the fastest sort, and `DELETE ADJACENT
  DUPLICATES` follows its order
- [ ] after the MVP: a test-build flag that shuffles the order of equal keys after `SORT` without `STABLE`, so
  programs that depend on it fail their tests
- [ ] after the MVP: a build warning for `SORT … BY a` followed by `DELETE ADJACENT DUPLICATES … COMPARING a` when
  fields other than `a` are read afterwards
- [ ] `READ TABLE … BINARY SEARCH` on a table not sorted by the search key: decided by the same rule when it is
  compiled. With duplicates in a correctly sorted table the keyword documentation specifies the first hit (lowest
  line number), so that case is exact, not open
- [ ] regular expressions: a pattern must be a literal or a finite set, checked at build time against what the
  engine supports; a computed pattern is a build error; the supported subset written down with test cases
- [ ] Open SQL semantics specified before the translation is ported: text order (binary order of code units),
  trailing blanks, null values against initial values, `LIKE`, types and rounding of SQL arithmetic and aggregates
- [ ] LUW semantics specified before the LUW code is ported: implicit database commits, `PERFORM ON COMMIT`, the
  update task, `ROLLBACK WORK`
- [ ] time zones from ABAP's own rules (the `TTZ*` tables, or the user setup without a database); Go's time zone
  database never used for ABAP time
- [ ] character properties: case mapping over a sweep of non-ASCII characters against expected values; `AS TEXT`
  and `SET LOCALE` stay build errors until specified
- [ ] per-session state decided in code before the first service root: statics, class constructors,
  `LOAD-OF-PROGRAM`, ABAP and SAP memory, `sy` fields, `SET COUNTRY`; no Go globals for any of them

## Reuse from open-steamgate

Decided 2026-11-25 ([aot_for_abap.md](aot_for_abap.md), "Reuse open-steamgate as far as the guiding principle
allows"): before building a part, look at how open-steamgate does it and take what fits. This runs alongside the
critical path: the rule tables stay abap2go's own, and every part taken has to pass them. Snapshot: `main`
`918a099` (2026-11-25).

- [ ] inventory: list open-steamgate's parts in the groups of the decision (taken as it is, taken then specified,
  ported, kept as abap2go's own), with the source files, their size and what each depends on, so the order below is set from it
- [ ] the seam between compiled code and the environment (database, LUW, locks, jobs, HTTP), defined before the
  first environment part is taken (see the "A seam first" point of the decision)
- [ ] runtime pieces that do not depend on the value model, as the compiler needs them: compression and
  checksums as they are; regular expressions, code pages, JSON parsing and HTTP utilities with their rules
  written down and tested first (revised 2026-11-25)
- [ ] the lowering of statements, construct by construct as the compiler grows, each with its test classes from
  `tools/gogen/testdata*`; expected answers that contradict a rule-table cell reopen that cell
- [ ] `ANORMALIES.md`: each entry checked against the rule tables; an entry outside them becomes a cell or a work
  item
- [ ] attribution kept current: `NOTICE` names every file taken or ported, with the pinned commit

## Work items

Reranked 2026-11-24 under the Purpose: the AOT compiler first. The critical path (the rule-table specification)
is above. Below it, in order:
1. abaplint: valid ABAP that abaplint misparses, mistypes or rejects. The compiler's input is code that already
   activates, so these produce wrong native code or refuse a valid program
2. open-abap-core: the pure-ABAP classes an AOT service actually calls (RTTI, JSON, the HTTP server side)
3. abaplint: invalid ABAP that abaplint accepts. Correct to fix, but it barely affects AOT output

### 1. abaplint: valid ABAP mistreated (review on main `af7440a`, 2026-11-23)

All 380 open issues were read; the parser / check_syntax ones run through abaplint (default config, `v757`).

- [ ] **#1809** a macro of the same name in two methods: the second call expands the first definition, `"foo" not
  found`; macros need scoping by position (keyword documentation: a macro is valid from its DEFINE onward). Valid
  code is expanded wrongly
- [ ] `INSERT itab.` parses as InsertDatabase (context-free parser); putting it in the InsertInternal grammar is a
  design question for the abaplint maintainer, not raised. Valid code gets the wrong statement
- [ ] side finding, no issue: `NEW lcl( )->attr = 1.` gives "Not an object reference, target" for any attribute.
  Check first that ABAP accepts it; if so, valid code is rejected
- [ ] dataset statements: #4644 (ENDIAN, TRUNCATE AT POSITION, SET DATASET ATTRIBUTES not parsed) and #4645
  (inline declarations not handled): valid code fails to parse or is mistyped

- in flight: #4329 (`|` and `}` in EXEC SQL or an AMDP body taken as a string template, valid code mis-lexed) is
  in PR abaplint#4684; in the abaplint patch
- done: #4700 (`WRITE` of a utclong gives "Source not character like", valid code rejected), PR abaplint#4701,
  released in abaplint 2.120.119
- in flight: #4714 (`NOT NOT a = 1` does not parse, valid code rejected; also in `LOOP`, `DELETE` and `MODIFY …
  WHERE`): PR abaplint#4716 is merged, not released yet; in the abaplint patch

Suggested order: #1809, then the dataset pair; `INSERT itab.` after asking the abaplint
maintainer.

### 2. open-abap-core: what an AOT service calls (TODO review on main `fbc211e`, 2026-11-23)

Its pure-ABAP classes are compiled into AOT binaries as they are; kernel and JS parts do not carry over. A stub
(`ASSERT 1 = 'todo'`) a root can reach is a run-time failure SAP does not have, so the AOT compiler will have to
refuse such a root at build time; every stub implemented removes such a refusal. `grep -rni todo src` (icons
excluded) gives about 350 markers in 82 files: about 280 stub methods, about 30 places that run but are known
incomplete or wrong, 2 placeholder values and a few refactoring notes. Work out the expected behaviour first, as
everywhere in this file.

Most useful for AOT first:
- [ ] RTTI (~10), on the open-DDIC / RTTI path of the design: `get` of `cl_abap_structdescr`/`tabledescr`/`refdescr`
  for some kinds, `get_with_keys`, `get_ddic_object`, `is_instantiatable`, `get_decfloat16`, a `describe_by_data`
  branch. #1348 (`describe_by_data` of decfloat16) belongs here
- [ ] `/ui2/cl_json` (5), what services serialize with: ref to interface, `generate`, some (de)serialize branches,
  `pretty_name` ignored in one path
- [ ] HTTP (~80), the server side first, since `if_http_extension` roots run on request and response entities. Plan
  of 2026-11-23, one PR per step, expected behaviour from public docs only (clean room, never SAP source):
  - [ ] step 1, string functions: `cl_http_utility` `escape_javascript`, `escape_xml_attr_value`,
    `normalize_url`, `get_last_error`; `cl_http_server` static helpers (`escape_url`, `unescape_url`,
    `escape_html`, `encode/decode_base64`, `append_field_url`) delegate to `cl_http_utility`;
    `cl_http_client` `escape_url`, `create_abs_url` (host + `~request_uri`). Fixes of existing methods in PR
    open-abap-core#1352; the new methods follow once it is merged. Gaps raised: #1353 (step 4), #1354
  - [ ] step 2, entity state: `cl_http_entity` gets a cookie table, a version and a table of multipart parts
    (each a `cl_http_entity`); then cookies (`add_cookie_field`, `get_cookie(s)`, `set_cookie`,
    `delete_cookie*`, `get_cookie_field`), header/form-field deletes, `append_data`, `append_cdata`,
    `get_data_length`, `get/set_version`, `get_last_error`, `get/set_authorization`, `get_user_agent`,
    `get_uri_parameter`, `get_form_data`, response `redirect` and `delete_cookie_at_client` as status + headers
  - [ ] step 3, messages and multipart: `to_xstring`/`from_xstring` (start line, CRLF headers, blank line,
    body), then `get_raw_message`, `get_serialized_message_length`, `copy`; multipart `add_multipart`,
    `num_multiparts`, `get_multipart` (parse by `boundary=`, serialize in `to_xstring`)
  - [ ] step 4, client: `send` writes cookies, multipart bodies and form fields (urlencoded POST body, check
    ABAP first); `receive` keeps array headers (`set-cookie` is skipped by `Array.isArray` today) and fills the
    cookies; `refresh_request`; classic exceptions of `create_by_url` (`sy-subrc` forced to 0)
  - stay stubs: `create_by_destination`, `cl_web_http_client_manager=>create_by_http_destination` (SM59),
    `create_internal`, server sessions/XSRF/`logoff`/`send_page`/extension info, `server_cache_*`
- [ ] conversions and date/time (~20): `cl_abap_datfm` (`conv_date_int_to_ext`, `conv_period_ext_to_int`),
  `cl_abap_timefm`, `cl_gdt_conversion` (only UTC), codepage replacement character and endian in
  `cl_abap_conv_codepage`/`cl_abap_conv_in_ce`
- [ ] sXML (~20): `cl_sxml_string_reader` only handles JSON, not XML; namespace/path APIs, `set_value*`,
  attribute setters; writer `set_option`, `write_namespace_declaration`, a `json_write_value` branch
- [ ] iXML (~45, `cl_ixml.clas.locals_imp.abap`): filters and filtered iterators, `insert_child`, `get_type`,
  `get_namespace_prefix`, encodings, ostream to itable, parser `get_error`/`num_errors`, `set_declaration`
- [ ] small and self-contained: `cl_bcs_convert` (`string_to_soli/solix`, `solix_to_xstring`, `raw_to_string`),
  `cl_message_helper` (5), `cl_abap_container_utilities`, `cl_abap_exceptional_values`, `cl_abap_gzip` text
  methods, `cl_abap_dyn_prg` (2), ADBC (`commit`/`rollback`/`close`, `get_metadata`, `next_package`,
  `set_param_struct/table`), `SCMS_BINARY_TO_XSTRING`

Known incomplete or wrong (they run), most relevant first:
- [ ] `cl_http_client`: no classic exceptions, `sy-subrc` forced to 0, reason text `'todo_open_abap'` (tests
  assert it)
- [ ] `cl_abap_tstmp` generic packed input "most likely wrong"; two tests commented out (rounding)
- [ ] `cl_abap_elemdescr` ignores `P_LANGU`; `cl_i18n_languages`, `cl_gdt_conversion` do not read DB tables first
- [ ] `cl_abap_regex`: two leftover attributes, a partial feature (line 73)
- [ ] `cl_ixml`: `DEPTH` ignored, two no-ops marked "should this do something?", four `RETURN. " todo`
- [ ] `cl_oo_factory` returns a shared instead of a new instance
- [ ] `cl_abap_random` returns only positive integers
- [ ] placeholders: `SYSTEM_CALLSTACK` gives `'ZTODO'` as program and include; call transformation writes the
  namespace `.../class-pool/TODO`

Not relevant for AOT, not picked up:
- kernel parts (~8: refs in `kernel_ixml_xml_to_data`, `traverse_write` in call transformation, secondary keys in
  `kernel_create_data_handle`), `kernel_call` ("all wrong as the name overlaps"), `kernel_unit_runner` (quit level,
  exception message) and `cl_abap_unit_assert=>abort`: kernel stand-ins and the unit runner do not carry over (the
  AOT compiler generates its test runner)
- `cl_abap_hmac`, `cl_abap_message_digest` "may not work in the browser": a JS host concern
- refactoring notes (out of scope): `cl_abap_typedescr` should be ABSTRACT, some `structdescr`/`tabledescr`
  methods should be private, `cl_sql_result_set` public attributes, a hack in `kernel_call_transformation`, memory
  use of `cl_abap_zip`, optimisations in `/ui2/cl_json`
- stay stubs (SAP server infrastructure, ~80, an environment matter): BCS sending (`cl_bcs`, `cl_document_bcs`,
  `cl_send_request_bcs`, `cl_cam_address_bcs`, `cl_bcs_mail_*`), shared memory (`cl_shm_*`),
  `cl_package_factory`, `cl_mime_repository_api`, `cl_abap_memory_utilities`, most of `cl_http_server`, APC TCP,
  exchange rates, factory/holiday calendars, number ranges, OAuth2 config writer, `DOCU_GET`,
  `CONVERT_ITF_TO_STREAM_TEXT`, `WWW*`

- testing: `npm test` in the open-abap-core root

### 3. abaplint: invalid ABAP accepted

Correct to fix (ABAP is the reference), but it barely affects AOT output, because the compiler's input already
activates on SAP. Lower priority than sections 1 and 2.

check_syntax (no error from abaplint where ABAP is expected to give one):
- [ ] **#2088** rest: assignment to an IMPORTING (by reference) parameter or a constant is reported; `SORT itab`,
  `APPEND ... TO itab` and `CLEAR text` on IMPORTING parameters are not. Overlaps #2097 / #4635 (write positions);
  do it together with #4635
- [ ] **#4683** INTO before WHERE when WHERE has an SQL expression (strict mode): only the `strict_sql`
  rule reports it, and too broadly; add to `strictModeChecks` in `5_syntax/expressions/select.ts`
- [ ] APPEND (and other index operations) to a generic `ANY TABLE` is expected to be an error, abaplint only checks
  hashed; the test "ok, APPEND TO generic tables" still expects no error for `ct_any`
- [ ] **#1692** PRIVATE SECTION of a global class uses a class from `locals_imp`: no error (only the PUBLIC SECTION
  check exists, "is local to the class pool")
- [ ] #895 `CLASS lcl DEFINITION DEFERRED.` and the class never defined
- [ ] #3398 REPORT statement in an include program (SUBC I) that is included in a report
- [ ] #3611 rest: TYPES names over 30 characters (BEGIN OF name, table type) not reported; field names and DATA
  names are
- [ ] #3041 `APPEND INITIAL LINE TO sorted_tab`: the docs suggest a runtime check (ITAB_ILLEGAL_SORT_ORDER); work
  out the expected behaviour before any PR, ask to close if runtime only
- [ ] #4643 DELETE/GET/SET DATASET operands are not checked; `syntax/statements/transfer.ts` looks for a Target
  that the TRANSFER grammar never produces (not raised)

Expected behaviour not worked out yet: #3398, #1692. Dropped: #3414 is an ABAP Cloud issue ("Class ... not
found/released"), and ABAP Cloud is not the reference.


Diagnostics only (no effect on what is accepted):
- [ ] #2267 a statement that does not parse inside a method gives "Expected ENDMETHOD" at the start of the class,
  far from the real error; the maintainer points to the structure rewrite #1975, so probably large

Rules that replace the syntax check (2026-11-23). Some findings that ABAP gives as syntax errors come from rules,
not from check_syntax: they can be switched off, and code that uses SyntaxLogic directly (e.g. downport) does not
see them. Such checks belong in check_syntax. abap2go already turns on unknown_types, implement_methods and
begin_end_names next to check_syntax (`src/validation.ts`), so for those three the gain is consistency. Inventory done:
on a snippet for each, check_syntax alone reports nothing and the rule reports it. ABAP is expected to give an
error for:
- unknown_types: unknown type (respects errorNamespace, keep that when moving)
- implement_methods: method or interface method not implemented; ABSTRACT method in a non-abstract class
- method_implemented_twice: METHOD twice; method declared twice
- superclass_final: INHERITING FROM a FINAL class
- begin_end_names: END OF name differs from BEGIN OF; TYPES BEGIN OF without components
- identical_form_names: two FORMs with the same name
- check_include: INCLUDE that does not exist (without IF FOUND)

Not syntax errors, dropped: mix_returning (a Clean ABAP style rule), unhandled_classic_exception (a runtime
error). Not part of the source syntax check, dropped: global_class, cloud_types, local_testclass_consistency.
- [ ] start with one small, clear case as a PR, so the shape (move the check, what happens to the rule) is
  settled in review before the rest follow, once #4690 is answered. Suggested first: identical_form_names or
  superclass_final (small, self-contained)
- note: our own open PRs #4633 and #4636 report through unknown_types; once the approach is agreed, they move too

Non-Unicode-only syntax (2026-11-22). abaplint has no notion of non-Unicode programs: no config setting, the
UCCHECK flag of the program is not read. The grammar accepts old and modern forms together, while the syntax check
assumes Unicode (e.g. byte lengths in `_check_database_work_area.ts`). In modern ABAP every program is Unicode, so
non-Unicode-only forms are expected to be syntax errors; abaplint accepts them for every `syntax.version`. Following
ABAP, this belongs in the parser / check_syntax, not in a rule option.
- [ ] confirmed case: `OPEN DATASET f.` without `FOR ...` and `IN ... MODE`; all OPEN DATASET additions became
  optional in 66bfba641 (#3571). Ask the maintainer whether that was for old code on purpose, then a check
  depending on the release rather than undoing it
- [ ] inventory first: work out the expected behaviour of the usual non-Unicode-only forms (offset/length on
  structures, old DESCRIBE forms, TRANSLATE ... CODE PAGE, ...), compare with abaplint, raise the gaps as issues

Testing note: `npm test`/`--parallel` gives 25-37 "statement type" failures, all 250ms timeouts under load, and a
timeout skips the rest of that file. Serial: `npx mocha --no-config --no-package --recursive build/test/abap/syntax`
(the package.json `spec` overrides a folder argument otherwise)
