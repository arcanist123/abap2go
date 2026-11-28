# abap2go compiler roadmap

Issue numbers: `abaplint#` = abaplint/abaplint; a bare number belongs to abap2go.

## Purpose

**The goal is an AOT compiler for ABAP:** ABAP compiled ahead of time into standalone executables that run at a
speed comparable to Go, with no ABAP application server and no JS runtime (a database, embedded or external, is
allowed). The design is [aot_for_abap.md](aot_for_abap.md). Work on open-abap-core and work on abaplint are lines of
work of their own, each with its rules, priorities and status: [open-abap-roadmap.md](open-abap-roadmap.md) and
[abaplint_roadmap.md](abaplint_roadmap.md).

Priority, when choosing what to pick up next:
1. **the specification of ABAP's rule tables** (the critical path, below): runtime-neutral, SAP is the reference
2. **open-abap-core**: its pure-ABAP classes (RTTI, XML, JSON, HTTP, conversions, ...) are compiled into AOT
   binaries as they are; its kernel and JS parts do not carry over

- ABAP behaviour is the reference. **Classic modern ABAP is the reference**: the current on-premise language with
  its modern syntax (7.40 and later), not ABAP Cloud
- the expected behaviour is worked out (keyword documentation) and written down as tests before it goes into code
  or a PR
- nothing that would stop ABAP from compiling ahead of time: nothing that needs a JS host or a compiler at run time
- out of scope: the transpiler's JS runtime. Its issues matter as cells of the specification (a snippet with
  ABAP's expected behaviour), not as JS fixes, which are tracked with the transpiler, not here
- of the list processor's statements only `WRITE` is in scope (2026-11-26): `ULINE`, `SKIP`, `NEW-LINE`,
  `NEW-PAGE`, `FORMAT`, `POSITION`, `BACK`, `RESERVE`, `TOP-OF-PAGE`, `END-OF-PAGE` and the interactive list events
  are not compiled, and their abaplint issues are not picked up
- **`WRITE` takes strings only (2026-11-27):** `WRITE [/] <operand>` with a text literal, a string template or a
  variable of the built-in type `string`; nothing else is compiled. abap2go's list is stdout, not a report on a
  screen, so the classic list formatting buys nothing. Out of scope: `WRITE` of any other type (numbers, `c`, `d`,
  dictionary types), positions and lengths, `AT`, `NO-GAP`, justification, the formatting additions, `WRITE … TO`
  and `DESCRIBE … OUTPUT-LENGTH`. Formatting is written out in a string template
  (`WRITE |{ amount NUMBER = USER }|`, `|{ matnr ALPHA = OUT }|`), so no statement in scope calls a conversion
  exit implicitly (see [aot_for_abap.md](aot_for_abap.md), "Conversion exits: only explicit calls"). The list
  layout already ported stays: one blank between outputs, `/` starts a line, trailing blanks removed

This file is the source of the compiler's status.

## Milestone 1: elementary fields, correct and compiled statically

Defined 2026-11-28. **Every operation on elementary fields in a report's `START-OF-SELECTION` compiles to typed
code, chosen at build time, whose results are those of the rule tables, and every cell of the tables is run on both
the static and the generic path.** The milestone is reached when every exit criterion below holds; until then, work
outside it waits unless the milestone needs it.

**The root.** A report (`PROG`), and of it only `START-OF-SELECTION`: its blocks and the statements before the
first one. Not part of the milestone: the other reporting events (`INITIALIZATION`, `END-OF-SELECTION`,
`LOAD-OF-PROGRAM`, …), selection screens, `FORM`, local classes, methods and function modules, and the class root
(`if_oo_adt_classrun` with `out->write( )`), which stays as it is. Output is `WRITE` of strings and string templates (see "Purpose").
With no parameters, field symbols or references, every operand has a static type: in compiled code nothing is left
to the generic path.

**The data.** `DATA`, `CONSTANTS` and `TYPES` of the 16 elementary kinds (`c n d t x string xstring i int8 b s p f
decfloat16 decfloat34 utclong`), typed directly or through a data element or domain of the package, with `VALUE`;
inline declarations (`DATA(x) = …`); `sy-index`, `sy-fdpos` and `sy-subrc` as far as the statements below set them.

**The operations**, each with every cell of its rule table, the exceptions and the value a target is left with:
- moves: `=`, `MOVE`, `CLEAR`, `CONV`, `EXACT` (the conversion table, all 16 × 16 cells)
- arithmetic: expressions, `+= -= *= /=`, `ADD`/`SUBTRACT`/`MULTIPLY`/`DIVIDE`, the numeric built-in functions
  (`abs sign ceil floor trunc frac ipow sqrt exp log` and the others of the calculation type table), `b` and `s`
  with their ranges and overflow
- comparisons and predicates: `= <> < > <= >=`, `BETWEEN`, `IS INITIAL`, the string operators with `sy-fdpos`, the
  byte and bit operators, `boolc( )`, `xsdbool( )`, `abap_true` and `abap_false`, in `IF`, `CASE`, `WHILE`,
  `CHECK` and `ASSERT`
- subfields: offset and length on every type where they are valid, the whole-field forms (`u(*)`, `i+0`, `i(4)`)
  included
- string templates with their format options (the output formatting table) and `&&`
- built-in functions whose arguments and result are elementary, specified first as a table of their own (see the
  exit criteria): the text and byte functions (`substring` and its variants, `condense`, `to_upper`, `to_lower`,
  `to_mixed`, `from_mixed`, `translate`, `shift_left`, `shift_right`, `repeat`, `reverse`, `insert`, `segment`,
  `cmax`, `cmin`, `escape`, `distance`, and `find`, `count`, `contains` and its variants and `replace` without
  `regex` or `pcre`), the length functions (`strlen`, `xstrlen`, `numofchar`, `charlen`), the bit functions
  (`bit-set`, `boolx`) and the `utclong` functions (`utclong_add`, `utclong_diff`, `utclong_current`)
- the string and byte processing statements without `REGEX` or `PCRE`, in character and byte mode, with the
  `sy-subrc` and `sy-fdpos` they set: `CONCATENATE` (with `SEPARATED BY` and `RESPECTING BLANKS`), `SPLIT` into
  fields, `CONDENSE`, `TRANSLATE`, `SHIFT`, `OVERLAY`, `FIND` and `REPLACE` with a substring (`FIRST` and `ALL
  OCCURRENCES`, `SECTION`, `IGNORING CASE`, `MATCH COUNT`, `MATCH OFFSET`, `MATCH LENGTH`, `REPLACEMENT …`),
  `SET BIT` and `GET BIT`. They share the specification of the functions (see the exit criteria)
- `DESCRIBE FIELD` with `TYPE`, `LENGTH … IN CHARACTER MODE` or `IN BYTE MODE` and `DECIMALS`: with static types
  each result is a constant of the build
- special values ([spec/special_values.md](spec/special_values.md)): every cell, with
  `SPECIAL_VALUE_NOT_SUPPORTED` gone

Not part of the milestone: `IN` (ranges tables are internal tables), regular expressions (the `regex` and `pcre`
forms of the functions, `matches( )`, `match( )`, `FIND` and `REPLACE` with `REGEX` or `PCRE`, `SUBMATCHES`), the
table forms of the string statements (`CONCATENATE LINES OF`, `SPLIT … INTO TABLE`, `FIND` and `REPLACE … IN
TABLE`, `RESULTS`), the obsolete forms (`SEARCH`, `REPLACE` without `OCCURRENCE`), functions of tables (`lines( )`,
`concat_lines_of( )`), `DESCRIBE FIELD` with `OUTPUT-LENGTH`, `EDIT MASK`, `HELP-ID` or `COMPONENTS`, RTTI,
structures, internal tables, field symbols, references and objects.

**The memory layout.** It is written down per kind: the Go representation, its size, the range of lengths and
values, the initial value, and the invariants every operation keeps (a `c` field always holds its full length, a
`p` value fits its digits and decimals, a `b` stays in 0 to 255, …). The tests check the invariants after every
cell. `DESCRIBE FIELD … LENGTH … IN BYTE MODE` is where a program sees the size of a field, so the layout per kind
has its test cases there. The byte layout stays as decided ([aot_for_abap.md](aot_for_abap.md), "Storage"): `CASTING` and every
other operation that shows bytes of a field are refused at build time, and lifting that refusal is not part of
the milestone.

**The static path** ([aot_for_abap.md](aot_for_abap.md), "Static operands"): each cell of the conversion table is a
Go function on native values, called directly for a static move; the calculation type of every expression and the
comparison type of every comparison are fixed at build time, `i`, `int8` and `f` arithmetic is native Go with
overflow checks, `p` and decfloat are direct calls. `abap.Convert`, `abap.Calculate` and `abap.Compare` dispatch to
the same functions and stay as the generic path.

Exit criteria:
- [ ] the generated Go of a milestone program contains no call of `abap.Convert`, `abap.Calculate`,
  `abap.Compare` or `abap.CompareCalculated`, and no `abap.Expr` tree
- [ ] every cell of every rule table in `runtime/go/abap/testdata` (other than `IN` and `write.tsv`) is run against
  the generic path, and end to end as a compiled program with static operands; the two agree, also in the exception
  and in the value the target is left with, except where the specifications say they differ by design: a pair
  without a comparison type (a syntax error with static types, `COMPARE_NOT_SUPPORTED` on the generic path) and an
  `f` NaN compared with an `f` ([spec/special_values.md](spec/special_values.md)). Those cells have their own
  expected result on the static path. Today the predicate, case mapping and special value tables are run by
  no test, and the calculation contexts and logical expressions only in part
- [ ] the memory layout written down per kind, its invariants checked by the tests
- [ ] the built-in functions and the string and byte processing statements of the milestone specified as a rule
  table (`spec/functions.md` and its test cases): per function or statement form and operand kind the result type
  and value, the exceptions, `sy-subrc` and `sy-fdpos`, the trailing blanks of `c` operands, a target too short for
  the result, and the boundaries (offsets and lengths at and beyond the end, empty operands, characters outside the
  Basic Multilingual Plane); a statement and the function that does the same give the same result where the keyword
  documentation says they do; each cell run on both paths as above
- [ ] `DESCRIBE FIELD` specified per kind (`spec/describe.md` and its test cases): the type code, the length in
  both modes and the decimals, for every kind and length, also for fields typed through a data element
- [ ] the syntax errors on elementary fields are reported before the lowering: the `VALUE` literal that does not
  convert (abaplint#4712), the ranges of `b` and `s`, the non-Unicode-only forms; the scope pass refuses a program
  without the Unicode flag or without fixed-point arithmetic; `COMPUTE` is typed by abaplint (PR abaplint#4844, in
  2.120.125)
- [ ] the lowering reports every "not compiled yet" finding of a program, and none is left for an operation of the
  milestone
- [ ] the transpiler fixtures within the milestone run end to end, the six literal moves as written
- [ ] the data-dependent items on elementary fields are settled (see "Data-dependent differences"): `**`, `exp`,
  `log` on `f`, case mapping, `DO n TIMES` and subfield bounds beyond the range of `i`
- [ ] benchmarks of the static path against hand-written Go for integer, `p`, `f` and text kernels, recorded here
- [ ] CI runs `npm test`

### Steps

In this order. Each step leaves `npm test` passing and records its status under "The compiler". The static path
comes before the language is widened, so every operation added after it is built on that path once, instead of on
the generic path first and moved later. It comes after the special values, which still change the value model (a
decfloat that holds infinities and NaN, the sign of a NaN) and add cells to the three tables it makes static, so it
is built on the final value model (revised 2026-11-28). The specifications of steps 6, 8 and 9 do not depend on the
compiler and can be written ahead of their step.

1. [ ] **Layer 2 and the scope pass** (in progress, priority set 2026-11-27; details under "Next"): the `VALUE` literal
   that does not convert (abaplint#4712, done 2026-11-28), the Unicode flag and fixed-point arithmetic in the scope
   pass (done 2026-11-28), the non-Unicode-only forms, and the ports of the PRs that only add checks, of those the milestone needs only: for the
   statements compiled today abaplint#4739, #4741, #4761 and fork #1 to #3 (the fork's #4 to #6 come in step 7,
   abaplint#4635 waits for classes). Done 2026-11-28: the pin is on 2.120.125, which has #4739 and the `COMPUTE`
   fix (PR abaplint#4844), and #4741, #4761 and fork #1 to #3 are ported (`src/check/comparison.ts`,
   `src/check/case.ts`) and out of the patch (`patches/abaplint-skipped.txt`, which keeps the fork's #4 to #6 out
   as well). `COMPUTE` can be compiled now. The lowering collects every "not compiled yet" finding instead
   of stopping at the first, so what a program still lacks shows in one run. CI runs `npm test`
2. [ ] **The value model and the test harness**
   - `spec/storage.md`: the layout per kind (Go representation, size, ranges of lengths and values, initial value,
     invariants), the special values included (a decfloat that holds infinities and NaN, the sign of a NaN), and a
     check of the invariants in the runtime that every test runner calls after each cell
   - every rule table run against the generic path. Runners are added for the tables no test reads yet
     (`calculation_contexts`, `comparison_expr`, `comparison_predicate*`, `case_upper`, `special_*`); cells of
     operations the runtime lacks run as todos, as the transpiler fixtures do, so progress shows
   - an end-to-end runner that turns the cells of a table into compiled programs, many cells per program to keep
     builds short, as `test/result_field.test.ts` does for the result fields; the same todo rule
3. [ ] **Special values on the generic path** (details under "Next"): decided first how an executable ends where
   ABAP is expected to raise an internal runtime error (`MOD` of two decimal infinities) or not to finish (`ipow( )`
   with base 1 and an infinite `f` exponent); then the runtime holds them as `spec/storage.md` says, the cells of
   `special_conversion.tsv`, `special_calculation.tsv`, `special_comparison.tsv` and
   `special_comparison_expr.tsv` pass on the generic path and end to end, and `SPECIAL_VALUE_NOT_SUPPORTED` goes.
   The cells of `special_template.tsv` follow with string templates in step 6
4. [ ] **The static path for what compiles today** ([aot_for_abap.md](aot_for_abap.md), "Static operands"): the
   conversion cells as Go functions with `abap.Convert` dispatching to them, direct calls for static moves, the
   calculation type and the comparison type fixed at build time, native `i`, `int8` and `f` arithmetic with
   overflow checks, all checked against every cell, the special values included. A test asserts that the Go of every
   end-to-end program has no call of the generic path. The benchmarks are recorded before and after
5. [ ] **Declarations and moves**: `CONSTANTS`, `TYPES`, every data element and domain of the package, inline
   declarations, `MOVE`, `CLEAR`, `CONV`, `EXACT`, `abap_true` and `abap_false`, `sy-subrc`; the whole-field
   subfields (`u(*)`, `i+0`, `i(4)`, compiled as the field); the six transpiler fixtures that move a literal, run
   as written. Before them, in abaplint, the types the compiler would take over wrongly: an operand after a
   constructor expression (`CONV i( 1 ) + p` typed `i`, arcanist123/abaplint#17), a constant as offset or length
   (arcanist123/abaplint#18) and an inline declaration from a calculation with a text operand (`DATA(x) = i * '2'.`
   typed `i`, arcanist123/abaplint#22). #18 (PR abaplint#4850; the rest is arcanist123/abaplint#24 to #27) and #22
   (PR abaplint#4851) are fixed and in the patch (2026-11-28). Left are #17, and an inline declaration from a signed
   or parenthesised calculation (`DATA(x) = ( p + 1 ).` keeps the operand's decimals, arcanist123/abaplint#36)
6. [ ] **String templates, then `WRITE` of strings only**: the rest of the output formatting table specified (the
   template rules per kind and the format options), templates and `&&` compiled, then `WRITE` of other operands
   refused and its tests rewritten to `WRITE |{ x }|` (details under "Next")
7. [ ] **Arithmetic and predicates**
   - `ADD`, `SUBTRACT`, `MULTIPLY`, `DIVIDE` and the rest of `calculation_contexts.tsv`
   - the numeric built-in functions: the rest of the calculation type table specified, `**`, `exp` and `log` on `f`
     settled first (see "Data-dependent differences")
   - `b` and `s` with their ranges and overflow, on the patch, which carries PR abaplint#4631 until a release has it
   - `IS INITIAL`, the string operators with `sy-fdpos`, the byte and bit operators, `boolc( )` and `xsdbool( )`:
     all of `comparison_expr.tsv` and `comparison_predicate*.tsv` except `IN`, with the checks of fork #4 to #6
     ported to layer 2 first
8. [ ] **Built-in functions and string statements**: `spec/functions.md` and its test cases, the case mapping
   settled over non-ASCII characters first, then the functions and statements compiled on the static path
9. [ ] **`DESCRIBE FIELD`**: `spec/describe.md` and its test cases, then compiled as constants of the build
10. [ ] **The last data-dependent items**: `DO n TIMES` and the offsets and lengths of subfields beyond the range of
    `i`, specified, then matched or made a runtime error
11. [ ] **Close**: every transpiler fixture within the milestone runs, every exit criterion is checked off, and the
    benchmarks are recorded here

## The compiler (status 2026-11-27)

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
  - superseded on 2026-11-27 by "`WRITE` takes strings only" (see "Purpose"): this path is to be removed from the
    compiler (see "Next")
- the compiler runs on an abaplint release plus a patch (2026-11-26, before that a vendored fork build since
  2026-11-24): `@abaplint/core` is pinned to an upstream release, and `patch-package` applies
  `patches/@abaplint+core+<version>.patch` on `npm install`. The patch holds the abap2go PRs to abaplint that the
  release does not contain yet, open or merged but unreleased (listed in `patches/abaplint-prs.txt`);
  `scripts/abaplint-patch.sh` regenerates it, and each PR drops out once a release has it; a PR listed in
  `patches/abaplint-skipped.txt` is left out. Pinned to 2.120.125 since 2026-11-28; the patch holds #4631, #4633,
  #4635 and #4849 to #4851. The PRs that only add checks leave the patch as layer 2 takes them over, and #4684 (EXEC
  SQL and AMDP, which the compiler does not compile) is dropped. The fixes the compiler's
  features rest on (all work in abaplint: [abaplint_roadmap.md](abaplint_roadmap.md)):
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
  - with a variable length, a static offset at or beyond the end of a flat field (`c+5(len)` of a c of length 5) is
    expected to be valid code, so it compiles and raises when it runs (2026-11-26, before it was refused; abaplint
    accepts it since 2.120.121, abaplint#4742)
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
    and short-circuit evaluation (a subfield is computed only when its comparison is evaluated). 340 of the 404 cells
    of `comparison_expr.tsv` run end to end (`test/comparison_expr.test.ts`); the others wait for `IS INITIAL`,
    `CONV`, `boolc( )`, `xsdbool( )`, `utclong_current( )` and `abap_true`
  - `NOT` repeated any number of times (2026-11-25, abaplint #4714, PR abaplint#4716, in 2.120.121): an even number cancels out
  - `DATA` is not executable: every variable of a processing block exists from its start with its start value, also
    one declared in a loop or a branch
  - refused: `DO … VARYING`, `WHILE … VARY`, in classes `CASE` without `WHEN` and statements between `CASE` and the
    first `WHEN` (syntax errors there), comparisons of kinds without a comparison type (`d` with `t`, `utclong` with
    anything but `c`, `string` and `utclong`), a non-numeric single operand against an arithmetic expression, the other
    predicates (`IS`, `IN`, `CO`, …)
- the arithmetic tests of abaplint/transpiler as end-to-end fixtures (2026-11-25, `test/transpiler/*.txt`, run by
  `test/transpiler.test.ts`, MIT, see `NOTICE`): the 157 ABAP snippets of `test/operators/arithmetics*.ts`,
  `mod.ts`, `test/types/*_operations.ts`, `integer8_calculation_type.ts` and `conversion_no_number.ts`, one
  fixture file per source file, each snippet under the name of its source test
  - rewritten to `ASSERT` form: what a snippet wrote is asserted instead, with the expected value worked out again
    for ABAP. Some differ from the source tests: `int8 / int8` into `f` and into `p LENGTH 8 DECIMALS 1` is 3.5,
    not 3, since the calculation type is that of the result field
  - six snippets move a literal that does not fit the type: `-1` into `x LENGTH 1`, `'abc'`, `'1E3'` and `'2.5'`
    into `i`, `int8` and `f`, `'x10'` as a key of an `n` component. Their fixtures move the literal through a text
    variable, so the conversion at run time is tested. ABAP is expected to give only a warning for the snippets as
    written (revised 2026-11-26; first taken for syntax errors), so they are valid code and are to run as written,
    with the same result as through the variable
  - a snippet runs to its end (every `ASSERT` holds), or ends with the runtime error or exception its status line
    names (`int` overflow, `100 MOD 0`). 94 of 163 cases run end to end (79 before control flow, 93 before `TRY`);
    the other 69 are marked as waiting for what the compiler refuses first: string templates 22, structures and
    internal tables 11, `ADD`/`SUBTRACT`/`MULTIPLY`/`DIVIDE` 6, `sign( )` and `exp( )` 6, the literal moves as
    written 6 (their status line still says "syntax error"; to be changed to the result of the run, see above), `abap_true` and `abap_false` 5, `IS INITIAL` 4, `CONSTANTS` 3, `CLEAR` 2, field symbols 2, `CO` 1,
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
    as ABAP syntax errors reported by abaplint, `RETURN`, `EXIT`, `CONTINUE` and `CHECK` leaving a `CLEANUP` block,
    `RETRY` outside a `CATCH` block and a `CATCH` of a class not derived from `CX_ROOT`; constants and built-in data
    objects (`abap_true`) as operands
  - a `TRY` without `CATCH` or `CLEANUP` is expected to give only a warning, so it compiles (2026-11-26, before it
    was refused)
- built-in functions as comparison operands (2026-11-26, `src/lower_cond.ts`, `runtime/go/abap/function.go`,
  `test/function_operand.test.ts`): `abs( )`, `sqrt( )` and `strlen( )` of a single data object are values with the
  type of their result, compared as data objects are
  ([spec/comparison.md](spec/comparison.md), "Built-in functions as operands"), and evaluated only when their
  comparison is (`abap.ValueOf`). `ipow( )`, a function of an expression and a function with an arithmetic expression
  on the other side are calculated with the comparison
  - abaplint 2.120.120 rejected a `d` compared by `=` or `<>` with `abs( )` or `strlen( )` (`abs( d ) = d`), which
    ABAP is expected to accept; fixed in 2.120.121 (abaplint#4726, [abaplint_roadmap.md](abaplint_roadmap.md))
- `CASE` and `DO … TIMES` with expressions and built-in functions (2026-11-26, `src/lower_cond.ts`,
  `src/lower_block.ts`, `test/case_do.test.ts`)
  - `DO n TIMES` calculates an arithmetic expression or a built-in function once, as for an `i` result field, with the
    exceptions of that assignment
  - the operand of `CASE` is evaluated first, also when only `WHEN OTHERS` follows (before, a subfield was not
    checked then). An arithmetic expression is calculated in the calculation type of its own operands
    (`abap.CaseValue`) and compared as a data object ([spec/comparison.md](spec/comparison.md), "CASE")
  - a `WHEN` value is a data object or `abs( )`, `sqrt( )` or `strlen( )` of one, evaluated only when it is compared
  - a `p` result in a `string` whose rounding carries into one more digit now keeps 31 digits
  - refused: a `utclong` value against the number an expression gives. Syntax errors in these statements are left to
    abaplint ([abaplint_roadmap.md](abaplint_roadmap.md))
- `WRITE sy-index` (2026-11-26, `src/lower_report.ts`, `test/control_flow.test.ts`): its data element,
  `SYST_INDEX`, is expected to have the output length of `i` and no conversion exit, so it is written as an `i` (see
  "Output length" in [spec/write.md](spec/write.md))
- syntax checks removed from the compiler (2026-11-26 and 2026-11-27) where abaplint reports the case; the others
  move to layer 2 (see "Next"), and are listed in [abaplint_roadmap.md](abaplint_roadmap.md), "Syntax checks to move
  out of the compiler"
- parentheses around a single data object (2026-11-26): `( c )` is the data object `c`, not an arithmetic
  expression, in moves and comparisons. Before, it was calculated, so `n = ( c )` and `( c ) = i` could give another
  result, and `( c ) = c2` was refused
- number literals beyond `i` (2026-11-26, `src/lower_common.ts`, `test/build.test.ts`): a `p` of length 8 for up to
  15 digits, leading zeros not counted, and of length 16 above (abaplint#4736). Before, every one had length 16, so
  `WRITE` of such a literal of up to 15 digits took 32 characters instead of 16

- `CASE` in a program outside classes without any `WHEN`, or with statements before the first one (2026-11-27,
  `src/lower_block.ts`, `test/control_flow.test.ts`; before it was refused): ABAP is expected to give only a warning
  there. The statements run after the operand is evaluated and before it is compared; what they can change in it is in
  [spec/comparison.md](spec/comparison.md), "CASE". In classes both are syntax errors, which abaplint reports
  (abaplint#4744, PR abaplint#4784, in 2.120.123)

Next (the order is that of the milestone's steps above; this list keeps the details of each item):
- [ ] **first: layer 2 of the syntax check, `src/check/`** (priority set 2026-11-27, before every other item here;
  the design is [aot_for_abap.md](aot_for_abap.md), "The syntax check in two layers", the rules are
  [abaplint_roadmap.md](abaplint_roadmap.md), "Two layers")
  - [x] the pass (2026-11-28): `check(registry, layer1): Issue[]` in `src/check/index.ts`, called in `src/load.ts`
    right after `validate()`, so every finding of both layers is reported before any lowering. It takes the scopes
    from the same syntax run as `src/validation.ts` and `src/lower_common.ts` (abaplint caches it on the object),
    uses only abaplint's public API, and reports in abaplint's `Issue` format, with a key per check. An object with
    a finding of layer 1 is left out, as abaplint stops typing it at its first error. One file per group of checks,
    one test file per check file in `test/check/`, run without Go (`syntaxCheck` in `test/harness.ts`)
  - [x] the lowering's six syntax checks (2026-11-28). Three moved: `CONTINUE` outside a loop
    (`src/check/loops.ts`), static bounds outside an `n`, `d` or `t` field, constants and components of structures
    included (`src/check/substring.ts`), and a number literal of more than 31 digits, where leading zeros now count
    as they are expected to (`src/check/literals.ts`). Three went, as 2.120.123 reports every form the lowering
    checked (abaplint#4828, #4829): a `utclong` in a calculation, a subfield of a `utclong` and a static length of
    0; their tests expect abaplint's finding. The lowering refused the valid `u(*)` as a syntax error; it now
    refuses it as not compiled yet. The lowering has no syntax check left
  - [x] first, in abaplint: the syntax check skipped `COMPUTE` (no handler), so valid code in it was not typed.
    Fixed upstream by PR abaplint#4844, in 2.120.125, the pin since 2026-11-28; the compiler still refuses
    `COMPUTE` until it compiles it
  - then, what the compiler needs of layer 2 today, in this order:
    - [x] a subfield of a numeric type (2026-11-28, `src/lower_common.ts`, `test/substring.test.ts`): `i+0`, `i(4)`,
      `p(5)` and the like are valid ABAP (abaplint#4830, in 2.120.123) and gave Go that does not build. The lowering
      now refuses them as not compiled yet, as it does `u(*)`
    - [x] a `VALUE` literal that does not convert to its field's type (2026-11-28, `src/check/value.ts` and
      `convertible.ts`, `test/check/value.test.ts`; abaplint#4712, open): `DATA x TYPE i VALUE 3000000000.` or a `b`
      of `VALUE 300` was built and failed at run time. The rule and its types, which also cover the ranges of `b`
      and `s`, are in [spec/conversion.md](spec/conversion.md), "The literal of VALUE", with 3,637 cells
      (`value_literal.tsv`). A move of such a literal (`b = 300.`) stays valid and a run-time error. The cells found
      that the runtime did not finish a conversion of a text with an exponent far beyond a decimal floating point
      number (`'1E99999999999'`): fixed. Left: a constant named after `VALUE`, with `CONSTANTS` in step 5
    - [x] the Unicode flag (2026-11-28): the compiler did not read `UCCHECK`, so a program without it was compiled as
      Unicode. The scope pass refuses it now (below)
  - port the checks of the waiting PRs on the abaplint fork and of the abaplint PRs that only add checks (listed in
    [abaplint_roadmap.md](abaplint_roadmap.md), "Invalid syntax to fix, without a check in the compiler"), one at a
    time, each leaving the abaplint patch as its port lands, and only those milestone 1 needs (decided 2026-11-28):
    abaplint#4739 (`RETRY`), #4741 (comparison types) and #4761, then fork #1 to #3 (`CASE`, `WHEN` and parentheses
    in comparisons) in step 1; fork #4 to #6 (string and byte operators) in step 7, with those operators.
    abaplint#4635 (a `READ-ONLY` attribute written from outside its class) waits until classes are compiled, and
    stays in the patch until then. The upstream PRs stay open for the maintainer, without further rebasing
  - the non-Unicode-only forms in a Unicode program ([abaplint_roadmap.md](abaplint_roadmap.md), "Non-Unicode-only
    syntax"); refusing a program without the flag is the scope pass, below
  - `b` and `s`: the size, value range and overflow of `INT1` and `INT2`, once abaplint gives the size on the type
    (abaplint#4631, in the patch); the overflow at run time belongs to the lowering, the static range checks here (of
    `VALUE`, done)
  - macros: map each expanded token back to its absolute position, in the `DEFINE` body or in an argument at the
    call, by rebuilding the text abaplint lexes for the expansion; a test fails if abaplint changes how it expands
  - a layer 2 check goes once an abaplint release reports its case in every form; its tests then expect abaplint's
    finding
  - not syntax checks: the scope pass (next item), and in the lowering the refusals of valid code not compiled yet, a `utclong` after
    `WHEN` against a calculated `CASE` operand (`caseValue` in `src/lower_cond.ts`) and a subfield of a numeric type
    (`lowerSubstring`), which could be compiled as the whole field
- [ ] **the scope pass, `src/scope/`**: valid ABAP that abap2go does not compile by design, reported before the
  lowering under its own heading (decided 2026-11-28, [aot_for_abap.md](aot_for_abap.md), "Four kinds of refusal")
  - [x] the pass (2026-11-28): `scope()` in `src/scope/index.ts`, called in `src/load.ts` after layer 2. The
    findings of the abaplint rules in `SCOPE_RULES` move there from layer 1, so they no longer keep layer 2 from
    checking the object. The test harness `syntaxCheck` returns the findings of both headings
  - [x] statements with more than one meaning (2026-11-28, [abaplint_ambiguous_parsing.md](abaplint_ambiguous_parsing.md),
    "Rule for now"): every `ambiguous_statement` finding, also where the name would decide (`test/scope/ambiguous.test.ts`)
  - [x] the Unicode flag and fixed-point arithmetic (2026-11-28, `src/scope/attributes.ts`,
    `test/scope/attributes.test.ts`): read from the XML of each program, function group, class and interface; an object
    whose XML lacks the flag (`unicode_flag`) or `FIXPT` (`fixed_point_arithmetic`) is refused, one without an XML file
    is taken to have both ([abaplint_ambiguous_parsing.md](abaplint_ambiguous_parsing.md), "Program attributes"). The
    exception classes of `lib/` had no `FIXPT` and have it now
  - an object that defines the same macro name more than once
  - the restrictions of AOT compilation the lowering refuses today (code named dynamically, `CASTING`, ...), as they
    come up
- [ ] the lowering's refusals: collect every "not compiled yet" finding and report them all, instead of stopping at
  the first; internal errors (a case the checks rule out, such as "malformed arithmetic expression") get their own
  error class ([aot_for_abap.md](aot_for_abap.md), "Four kinds of refusal")
- [ ] control flow, the rest: `IS INITIAL`, `IN` and the string, byte and bit operators with `sy-fdpos`
  ([spec/comparison.md](spec/comparison.md), "Predicate expressions and comparison operators"; `IN` once ranges
  tables are compiled), their cells run by the tests; the other predicates once the comparison table has them;
  `CONV`, `boolc( )`, `xsdbool( )`, `utclong_current( )` and `abap_true` as operands of comparisons and `CASE`
- [ ] static operands resolved at build time (decided 2026-11-25, [aot_for_abap.md](aot_for_abap.md), "Static
  operands: the cell is chosen at build time, after control flow is compiled"), **after `ASSERT` and control flow
  above**: each conversion cell a Go function that `abap.Convert` dispatches to and the compiler calls directly; the
  calculation type fixed at build time, `i`, `int8` and `f` as native Go operations with overflow checks, `p` and
  `decfloat34` as direct calls; comparison types chosen at build time; every TSV cell run on both paths
  - a literal that does not convert to its static target, moved by `=` (`i = 'abc'.`), is expected to give only a
    warning: valid code, whose conversion fails at run time as for a variable. Such a move already compiles and
    raises when it runs, and stays so when its cell is chosen at build time; the six "as written" transpiler fixtures
    are its test cases. Only the literal of a `VALUE` addition that would raise is a syntax error, reported by
    layer 2 (see the first item)
  - their status lines still say "syntax error": change them to the result of the run. Two of the six build today
    (`arithmetics`, `integer_operations` "from text"), four wait for `abap_true`, `CLEAR` and `TYPES`
- [ ] the rest of `calculation_contexts.tsv` as its statements are compiled: inline declarations, templates, `CONV`,
  `EXACT`, `ADD` and the others, the result field after an exception (with `TRY`). The expression parser of
  `calculation_test.go` still attaches a leading `-` to its operand; fix it if it is to run these cells too
- [ ] arithmetic beyond `result = expression`: inline declarations (`DATA(r) = …`, the declared type of
  [spec/calculation.md](spec/calculation.md)), `EXACT` and `CONV`, expressions as operands of `out->write( )` and
  embedded in string templates
- [ ] string templates (`|…{ x }…|`) as a source of moves, `WRITE` and `out->write( )`, with the rules of the
  output formatting table (under "Critical path"): the format options first that replace the `WRITE` formats
  (`NUMBER`, `DATE`, `TIME` with `USER` and `ENVIRONMENT`, `ALPHA`, `DECIMALS`, `CURRENCY`, `WIDTH`, `ALIGN`)
- [ ] `WRITE` of strings only (decided 2026-11-27, see "Purpose"), **after string templates**: `WRITE` of any
  other operand is refused at build time (`src/lower_report.ts`), `checkWriteFormat` and the output lengths in
  `src/lower_common.ts` and the `abap.Format` call in `src/emit_go.ts` go. The tests and examples that `WRITE`
  other operands (`sy-index` and number literals included) are rewritten to `WRITE |{ x }|`, which changes their
  expected output. `abap.Format` and [spec/write.md](spec/write.md) stay in the runtime only as far as the string
  templates reuse them
- [ ] special values ([spec/special_values.md](spec/special_values.md), "Implementation"): a decfloat value that
  holds infinities and NaN, the sign of a NaN set by the runtime, the cells of the `special_*.tsv` files run by the
  tests, and the comparisons of a statically typed `f` pair, other data objects and arithmetic operands told apart.
  Then `SPECIAL_VALUE_NOT_SUPPORTED` goes, with its exception in [aot_for_abap.md](aot_for_abap.md). Decide first
  how an executable ends where ABAP is expected to raise an internal runtime error (`MOD` of two decimal infinities)
  or not to finish (`ipow( )` with base 1 and an infinite `f` exponent). The cells of string templates follow with
  string templates
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
| output formatting | string templates (`WRITE` takes strings only since 2026-11-27, see "Purpose") |

Done:
- `WRITE` of the output formatting table, [spec/write.md](spec/write.md) (2026-11-24): output length and rule per
  kind, the user settings it depends on (decimal notation, date format), and 916 test cases
  (`runtime/go/abap/testdata/write.tsv`). Out of scope since 2026-11-27 (`WRITE` takes strings only); kept as the
  reference for the string templates' options that follow the user settings
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
- special values, [spec/special_values.md](spec/special_values.md) (2026-11-27): what the conversions, arithmetic,
  functions, comparisons, string templates, `CASE`, `DO` and subfields do with an `f` holding `+Inf`, `-Inf` or NaN
  and a decimal floating point number holding an infinity or a NaN; 8,407 cells (`special_*.tsv`, specified, not
  run by the tests yet). Open: `SORT` and table statements, parameters, Open SQL, `out->write( )`, the other
  built-in functions. The implementation is under "The compiler", "Next"

What the tables have to settle, by example: the issues raised in abaplint/transpiler from #2019 on are one-off
findings of exactly these rules. Of 73, 57 fall inside the four tables or the structure rules (conversion 17,
calculation type and precision 11, overflow and range 8, structure moves 7, comparison 6, output formatting 6,
precedence 2). The tables are to settle such cases systematically, as grids of cells (every operator, kind, boundary
value and context), not one issue at a time; the snippets of those issues and PRs are a source of cells, and a cell
whose expected behaviour contradicts a spec is reopened there.

- predicates and operators of the comparison table (2026-11-27), [spec/comparison.md](spec/comparison.md),
  "Predicate expressions and comparison operators": `IS INITIAL`, the string operators with their `CP` patterns,
  case mapping and `sy-fdpos`, the byte and bit operators, and `IN` with the order in which the rows of a ranges
  table are evaluated; 1,703 cells (`comparison_predicate.tsv`), 596 of `IN` (`comparison_in.tsv`), 4,779 held-out
  random cells, 114 logical expressions with static types and the case mapping (`case_upper.tsv`). Specified, not run
  by the tests yet. Open: a `CP` pattern ending in a `#` that escapes nothing, a numeric built-in function as the
  right operand of an operator

Next:
- [ ] the rest of the comparison table: `IS ASSIGNED`, `IS BOUND`, `IS SUPPLIED`, `IS INSTANCE OF` and the predicate
  functions, structures, internal tables and references, and the comparisons inside statements
  (`READ TABLE … WITH KEY`, table keys, `SORT … AS TEXT`, `DELETE ADJACENT DUPLICATES`)
- [ ] structure rules of the conversion table: `MOVE-CORRESPONDING`, `CORRESPONDING`; flat structures with
  non-matching fragment views are refused at build time for now (decision "Storage", 2026-11-25), like every
  operation that depends on ABAP's memory layout
- [ ] the rest of the output formatting table: string templates (`|{ x }|`, with their own rules, including the
  styles for decfloat), with their format options. The `WRITE` additions (`DECIMALS`, `NO-GROUPING`, date masks,
  `CURRENCY`, …), `WRITE … TO` and `DESCRIBE … OUTPUT-LENGTH` are out of scope (2026-11-27, see "Purpose")
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
- [ ] `DO n TIMES` with a data object beyond the range of `i`: the build converts it as in an assignment, which
  raises the catchable `CX_SY_CONVERSION_OVERFLOW` (`CX_SY_CONVERSION_NO_NUMBER` for text that is no number). ABAP is
  expected to differ by type: a runtime error for `int8`, `p` and text, while an `f` or a decimal floating point
  number raises nothing and the passes do not follow from the value. To be specified, then made a runtime error or
  matched; offsets and lengths of subfields, which are converted the same way, need the same look
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
  item. The 43 entries on elementary fields are checked (2026-11-28, [open-steamgate-notes.md](open-steamgate-notes.md),
  "`ANORMALIES.md` against the rule tables"): abaplint mistypes one, the rest agree or are cells of the template
  and function specifications. Left: the entries on tables, the database and the environment, as those parts come
- [ ] attribution kept current: `NOTICE` names every file taken or ported, with the pinned commit
