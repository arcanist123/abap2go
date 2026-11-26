# abaplint roadmap

The work abap2go does in [abaplint](https://github.com/abaplint/abaplint) (parser, check_syntax): a line of work of
its own, next to the compiler's in [roadmap.md](roadmap.md). This file is the source of its status: what to pick up
next, in order, and why. Issue and PR numbers belong to abaplint/abaplint and link there. Open issues and PRs are
listed by `gh issue list -R abaplint/abaplint --author @me` and `gh pr list -R abaplint/abaplint --author @me`; this
file records their priority and what they mean for abap2go, not a copy of their state.

## Rules

- ABAP behaviour is the reference, not abaplint's rules. **Classic modern ABAP is the reference**: the current
  on-premise language with its modern syntax (7.40 and later), not ABAP Cloud
- the expected behaviour is worked out (keyword documentation) and written down as tests before it goes into code
  or a PR. Before raising an issue, tell a syntax error from a warning: ABAP accepts code with warnings, so a case
  that is expected to give only a warning is valid code, and abaplint is right to accept it
- **only the parser and check_syntax count**, including syntax errors that abaplint reports through a rule (see
  "Rules that replace the syntax check"). Style rules, rule options, rule false positives and rule ideas are not
  picked up, however small. Before taking an issue, ask: does it change what abaplint does with valid or invalid
  ABAP? If not, skip it
- also out of scope: releases below 7.40, refactoring, feature requests, and issues that need the reporter's
  private dependencies
- **abap2go does not reimplement the syntax check** ([aot_for_abap.md](aot_for_abap.md), "No syntax check of its
  own"): the compiler's code assumes valid ABAP, and invalid syntax that abap2go identifies is fixed here, never
  checked in the compiler instead
- what the compiler runs into, within the scope it compiles, is fixed right away, before the other work
- after that, valid ABAP that abaplint mistypes, fails to parse or rejects comes before invalid ABAP that it
  accepts: the compiler's types come from abaplint, so a mistyped expression becomes wrong native code, and its
  input is code that already activates

## How a fix gets in

`@abaplint/core` is pinned to an upstream release, and `patch-package` applies `patches/@abaplint+core+<version>.patch`
on `npm install`. The patch holds the abap2go PRs to abaplint that the release does not contain yet, open or merged
but unreleased (listed in `patches/abaplint-prs.txt`). Each PR drops out once a release has it.

1. Work out the expected behaviour, and raise an issue.
2. Branch from upstream `main`, write the fix and its tests, run abaplint's tests.
3. Open the PR upstream; it says `closes #N` for the issues it fixes.
4. Regenerate the patch with `scripts/abaplint-patch.sh` and run `npm test` here.

PRs that change the same code are stacked, since the script stops on a merge conflict.

Working with upstream: the maintainer (larshp) reviews and merges. Do not merge `main` into an open PR or press
"Update branch" unless GitHub shows a conflict or the maintainer asks: an out-of-date branch is fine, and an update
restarts CI and races with his merges. A PR may close other people's issues through `closes #N`, but other people's
issues are never closed by hand: for one that is already fixed, comment with the evidence (PR, test) and let the
reporter or the maintainer close it. Our own issues we close ourselves, also when one turns out to be raised in
error.

Testing in abaplint: `npm test`/`--parallel` gives 25-37 "statement type" failures, all 250ms timeouts under load,
and a timeout skips the rest of that file. Serial:
`npx mocha --no-config --no-package --recursive build/test/abap/syntax` (the package.json `spec` overrides a folder
argument otherwise).

## Now: what abap2go has run into

Reviewed 2026-11-26 against abaplint `main` `fc504b57`: every open issue in this file still behaves on `main` as it
describes.

Valid code rejected:
- [ ] [#4742](https://github.com/abaplint/abaplint/issues/4742) a static offset or length beyond a flat field while
  the other one is a variable (`c+5(off)`, `c+off(6)` with `c TYPE c LENGTH 5`): ABAP is expected to accept it and to
  decide at run time (`CX_SY_RANGE_OUT_OF_BOUNDS`). The compiler's own check refuses `c+5(off)` too
  (`src/lower_common.ts`). First of all open work. #4730, #4745 and #4746 change the same code (`_substring.ts`):
  stack them on its branch

[#4726](https://github.com/abaplint/abaplint/issues/4726) is fixed by
[PR #4727](https://github.com/abaplint/abaplint/pull/4727), in the patch.

Valid code mistyped: nothing open. The last case, a number literal beyond the range of `i` typed `i`
([#4736](https://github.com/abaplint/abaplint/issues/4736)), is fixed by
[PR #4737](https://github.com/abaplint/abaplint/pull/4737), merged and in the patch: such a literal is expected to be a `p`
without decimals, of length 8 for up to 15 digits (leading zeros not counted) and length 16 above.
- [ ] follow-up in the compiler, which types number literals itself (`integerLiteral` in `src/lower_common.ts`): it
  takes length 16 for every such `p`

### Invalid syntax to fix, without a check in the compiler

Found 2026-11-26, with 2.120.120 and the patch.

- [ ] [#4747](https://github.com/abaplint/abaplint/issues/4747) an arithmetic expression after `WHEN` (`WHEN a + 1`,
  `WHEN ipow( base = a exp = 2 )`, `WHEN abs( a + 0 )`) is accepted, while ABAP is expected to allow only a data
  object or a built-in function of one there. The build still refuses them, as operands it does not compile
- [ ] [#4748](https://github.com/abaplint/abaplint/issues/4748) `CASE ( a ).` and `WHEN ( b ).`, parentheses around
  a single operand (also `( abs( a ) )`, `( ( a ) )`, `( sy-index )`), are accepted, while ABAP is expected to reject
  them; the compiler compiles `CASE ( a ).` as without them. `CASE ( a + 1 ).` is valid
- [ ] [#4749](https://github.com/abaplint/abaplint/issues/4749) parentheses around a single operand as the argument
  of `strlen( )`, or of `abs( )` in a comparison, are accepted, while ABAP is expected to reject them
  (`i = abs( ( i ) ).` is valid)
- [ ] [#4750](https://github.com/abaplint/abaplint/issues/4750) a parameter name for the argument of `abs( )`,
  `abs( val = i )`, is accepted

### Syntax checks to move out of the compiler

The compiler still has syntax checks of its own, from before the decision that it does not reimplement the syntax
check. Each one goes once abaplint reports the case in every form. Compared on 2026-11-26 with 2.120.120 and the
patch.

Removed that day, since abaplint reports them:
- `RETURN`, `EXIT`, `CONTINUE` and `CHECK` leaving a `CLEANUP` block, a subfield of a string as a target, and
  `strlen( )` of an argument that is not character-like (reported by the release)
- `RETRY` outside a `CATCH` block ([#4723](https://github.com/abaplint/abaplint/issues/4723),
  [PR #4739](https://github.com/abaplint/abaplint/pull/4739), in the patch)
- `CATCH` of an interface or of a class not derived from `CX_ROOT`
  ([#4725](https://github.com/abaplint/abaplint/issues/4725),
  [PR #4740](https://github.com/abaplint/abaplint/pull/4740), merged, in the patch)
- a comparison of kinds without a comparison type, `d = t` or `utclong = i`
  ([#4728](https://github.com/abaplint/abaplint/issues/4728)), and a non-numeric operand compared with an arithmetic
  expression ([#4738](https://github.com/abaplint/abaplint/issues/4738);
  both [PR #4741](https://github.com/abaplint/abaplint/pull/4741), in the patch)

Removed that day, since it was no syntax error: a `TRY` without `CATCH` or `CLEANUP` is expected to give only a
warning. [#4724](https://github.com/abaplint/abaplint/issues/4724), which asked abaplint to report it, is closed.

abaplint accepts these, so the fix goes into abaplint:
- [ ] `CONTINUE` outside a loop (`src/lower_block.ts`): issue [#3660](https://github.com/abaplint/abaplint/issues/3660),
  with [PR #4653](https://github.com/abaplint/abaplint/pull/4653) of another author open (updated 2026-11-26). Review
  it rather than write our own; not ours, so not in the patch, and the compiler's check stays until a release has it
- [ ] [#4729](https://github.com/abaplint/abaplint/issues/4729) `utclong` in an arithmetic expression, `u + 1`
  (`src/lower_arith.ts`)
- [ ] [#4730](https://github.com/abaplint/abaplint/issues/4730) a subfield of length 0 of a flat field, `c+1(0)`
  (`src/lower_common.ts`)
- [ ] [#4743](https://github.com/abaplint/abaplint/issues/4743) a number literal of more than 31 digits
  (`src/lower_common.ts`): leading zeros are expected to count and the sign not, while the compiler strips leading
  zeros before counting. Also in a `VALUE` addition, which `Constant.runSyntax` does not see
- [ ] [#4744](https://github.com/abaplint/abaplint/issues/4744) `CASE` without any `WHEN` (`src/lower_block.ts`):
  a syntax error is expected in classes, only a warning in a program outside classes, where the compiler's check
  refuses valid code
- [ ] [#4745](https://github.com/abaplint/abaplint/issues/4745) a subfield of a `utclong` in a reading position,
  `s = u+1(1)` (`src/lower_common.ts`)
- [ ] [#4746](https://github.com/abaplint/abaplint/issues/4746) static bounds outside a flat field of type `n`, `d`
  or `t`, `d+8`, `n(5)` (`src/lower_common.ts`)

Statements between `CASE` and the first `WHEN` are part of
[#4744](https://github.com/abaplint/abaplint/issues/4744) for classes. In a program outside classes ABAP is expected
to give only a warning, so the code is valid there. The compiler refuses it as not supported yet, a gap of the
compiler ([roadmap.md](roadmap.md), "Next").

## Later: with the compiler step that needs it

The compiler steps are in [roadmap.md](roadmap.md), "Next".

| Issue | What | Pick up with |
|---|---|---|
| [#4712](https://github.com/abaplint/abaplint/issues/4712) | the literal of a `VALUE` addition that does not convert to a numeric type (`DATA i TYPE i VALUE 'abc'.`, a number outside the range) is accepted. A move of such a literal (`i = 'abc'.`) is expected to give only a warning: valid code, the conversion fails at run time | `CONSTANTS` and `DATA … VALUE` with static operands |
| [#4703](https://github.com/abaplint/abaplint/issues/4703) | `sy` components have no type name, so `TYPE sy-datum` cannot be told from `TYPE d`. The data elements are expected to be `SYST_<component>` with their own output lengths (`SYST_DATUM` 10) | `WRITE` of dictionary types with their own output length |
| [#4756](https://github.com/abaplint/abaplint/issues/4756) | a literal passed to a parameter of the generic type `p` is reported as not compatible: valid code rejected | method calls with parameters |
| [#4687](https://github.com/abaplint/abaplint/issues/4687) | `CORRESPONDING`: `APPENDING`, `EXACT`, lookup table and `MAPPING ... DEFAULT` not parsed (nested `MAPPING` is merged, [PR #4688](https://github.com/abaplint/abaplint/pull/4688)) | structures and `CORRESPONDING` |
| [#4642](https://github.com/abaplint/abaplint/issues/4642) | an assignment between flat structures with non-matching fragment views is accepted | structure assignments |

## Parked

Nothing in the compiler's scope needs these yet.

- [ ] [PR #4633](https://github.com/abaplint/abaplint/pull/4633) `METHODS` see only the types defined above them
  ([#2556](https://github.com/abaplint/abaplint/issues/2556)), until the compiler compiles classes. Changes requested:
  the maintainer sees the cause in the order abaplint reads a class definition (attributes and types first, then
  events, then methods), not in the type lookup that the PR filters. Rework it to read the statements in source order;
  that may also cover the follow-up for `LIKE`, `EVENTS` and `lcl=>ty` on branch `type-before-definition-followups`
  of the fork, to be opened as a PR once #4633 is merged. Stays in the patch meanwhile
- [ ] dataset statements, until file access is compiled, or a package to be built uses the forms of
  [#4644](https://github.com/abaplint/abaplint/issues/4644) or [#4645](https://github.com/abaplint/abaplint/issues/4645)
  (the build checks every object of the input packages, so these two refuse a valid program):
  - [#4643](https://github.com/abaplint/abaplint/issues/4643) `DELETE`/`GET`/`SET DATASET` operands are not checked;
    `syntax/statements/transfer.ts` looks for a Target that the `TRANSFER` grammar never produces (not raised)
  - [#4644](https://github.com/abaplint/abaplint/issues/4644) `ENDIAN`, `TRUNCATE AT POSITION` and
    `SET DATASET ATTRIBUTES` not parsed
  - [#4645](https://github.com/abaplint/abaplint/issues/4645) inline declarations not handled
- [ ] [#4683](https://github.com/abaplint/abaplint/issues/4683) `INTO` before `WHERE` when `WHERE` has an SQL
  expression (strict mode), until there is database support: only the `strict_sql` rule reports it, and too broadly;
  add to `strictModeChecks` in `5_syntax/expressions/select.ts`
- [ ] [#4690](https://github.com/abaplint/abaplint/issues/4690) rules that report syntax errors: waits for the
  maintainer's answer (see "Rules that replace the syntax check")

Closed as raised in error (2026-11-26), kept here so they are not raised again: a number literal of type `i` passed
to a `p` parameter with decimals is valid ([#4751](https://github.com/abaplint/abaplint/issues/4751)); an unsupported
HTML tag in ABAP Doc is expected to give warnings only ([#4655](https://github.com/abaplint/abaplint/issues/4655)).

## In the patch

PRs the pinned release does not contain, as of 2026-11-26:

| PR | What | State |
|---|---|---|
| [#4631](https://github.com/abaplint/abaplint/pull/4631) | INT1 and INT2 keep their size ([#4630](https://github.com/abaplint/abaplint/issues/4630)); the compiler declares `b` and `s` through data elements | open |
| [#4633](https://github.com/abaplint/abaplint/pull/4633) | `METHODS` see only the types defined above them ([#2556](https://github.com/abaplint/abaplint/issues/2556)) | changes requested, parked (see "Parked") |
| [#4635](https://github.com/abaplint/abaplint/pull/4635) | a write to a `READ-ONLY` attribute from outside the class ([#2097](https://github.com/abaplint/abaplint/issues/2097)). It also covers [#2611](https://github.com/abaplint/abaplint/issues/2611): add `closes #2611` to the PR, or comment on #2611 after the merge | open |
| [#4684](https://github.com/abaplint/abaplint/pull/4684) | `\|` and `}` in EXEC SQL or an AMDP body taken as a string template, valid code mis-lexed ([#4329](https://github.com/abaplint/abaplint/issues/4329)) | open |
| [#4716](https://github.com/abaplint/abaplint/pull/4716) | `NOT NOT a = 1` does not parse, also in `LOOP`, `DELETE` and `MODIFY … WHERE` ([#4714](https://github.com/abaplint/abaplint/issues/4714)) | merged, not released |
| [#4727](https://github.com/abaplint/abaplint/pull/4727) | a `d` compared with a built-in function or method result of type `i` (`d = strlen( s )`, `abs( d ) = d`) is rejected as incompatible ([#4726](https://github.com/abaplint/abaplint/issues/4726)); the compiler compiles these functions as comparison operands | merged, not released |
| [#4737](https://github.com/abaplint/abaplint/pull/4737) | a number literal beyond the range of `i` is typed `p`, not `i`; parameters, `VALUE` rows and `INSERT` rows are checked accordingly ([#4736](https://github.com/abaplint/abaplint/issues/4736)) | merged, not released |
| [#4739](https://github.com/abaplint/abaplint/pull/4739) | `RETRY` outside a `CATCH` block is an error ([#4723](https://github.com/abaplint/abaplint/issues/4723)) | open |
| [#4740](https://github.com/abaplint/abaplint/pull/4740) | `CATCH` of an interface or of a class not derived from `CX_ROOT` is an error ([#4725](https://github.com/abaplint/abaplint/issues/4725)) | merged, not released |
| [#4741](https://github.com/abaplint/abaplint/pull/4741) | comparisons without a comparison type, also after `WHEN`, and calculations compared with non-numeric operands are errors ([#4728](https://github.com/abaplint/abaplint/issues/4728), [#4738](https://github.com/abaplint/abaplint/issues/4738)) | open |

Released and out of the patch: `WRITE` of a utclong ([#4700](https://github.com/abaplint/abaplint/issues/4700),
[PR #4701](https://github.com/abaplint/abaplint/pull/4701), in 2.120.119), which the compiler now compiles.

## Backlog

Not run into by abap2go. All 380 open issues were read on 2026-11-23, and the parser / check_syntax ones run through
abaplint (main `af7440a`, default config, `v757`).

### Valid ABAP mistreated

- [ ] **[#1809](https://github.com/abaplint/abaplint/issues/1809)** a macro of the same name in two methods: the
  second call expands the first definition, `"foo" not found`; macros need scoping by position (keyword
  documentation: a macro is valid from its DEFINE onward). Valid code is expanded wrongly
- [ ] [#4757](https://github.com/abaplint/abaplint/issues/4757) `SPLIT ... IN BYTE MODE`: byte-like targets are
  rejected and inline targets are typed `string` instead of `xstring` (character targets are accepted, though an error
  is expected). `5_syntax/statements/split.ts` does not look at the mode. We offered a PR
- [ ] [#4755](https://github.com/abaplint/abaplint/issues/4755) `INSERT itab.` parses as InsertDatabase
  (context-free parser); putting it in the InsertInternal grammar is a design question for the abaplint maintainer.
  Valid code gets the wrong statement
- [ ] [#4754](https://github.com/abaplint/abaplint/issues/4754) `NEW lcl( )->attr = 1.` gives "Not an object
  reference, target" for any attribute

Suggested order: [#1809](https://github.com/abaplint/abaplint/issues/1809) first, then
[#4757](https://github.com/abaplint/abaplint/issues/4757);
[#4755](https://github.com/abaplint/abaplint/issues/4755) after the maintainer's view on the shape.

### Invalid ABAP accepted

No error from check_syntax where ABAP is expected to give one:
- [ ] **[#2088](https://github.com/abaplint/abaplint/issues/2088)** rest: assignment to an IMPORTING (by reference)
  parameter or a constant is reported; `SORT itab`, `APPEND ... TO itab` and `CLEAR text` on IMPORTING parameters
  are not. Overlaps [#2097](https://github.com/abaplint/abaplint/issues/2097) /
  [PR #4635](https://github.com/abaplint/abaplint/pull/4635) (write positions); do it together with
  [PR #4635](https://github.com/abaplint/abaplint/pull/4635)
- [ ] [#4752](https://github.com/abaplint/abaplint/issues/4752) APPEND (and other index operations) to a generic
  `ANY TABLE` is expected to be an error, abaplint only checks hashed; the test "ok, APPEND TO generic tables" still
  expects no error for `ct_any`
- [ ] **[#1692](https://github.com/abaplint/abaplint/issues/1692)** PRIVATE SECTION of a global class uses a class
  from `locals_imp`: no error (only the PUBLIC SECTION check exists, "is local to the class pool")
- [ ] [#895](https://github.com/abaplint/abaplint/issues/895) `CLASS lcl DEFINITION DEFERRED.` and the class never
  defined
- [ ] [#3398](https://github.com/abaplint/abaplint/issues/3398) REPORT statement in an include program (SUBC I) that
  is included in a report
- [ ] [#3611](https://github.com/abaplint/abaplint/issues/3611) rest: TYPES names over 30 characters (BEGIN OF name,
  table type) not reported; field names and DATA names are
- [ ] [#3041](https://github.com/abaplint/abaplint/issues/3041) `APPEND INITIAL LINE TO sorted_tab`: the docs suggest
  a runtime check (ITAB_ILLEGAL_SORT_ORDER); work out the expected behaviour before any PR, ask to close if runtime
  only

Expected behaviour not worked out yet: [#3398](https://github.com/abaplint/abaplint/issues/3398),
[#1692](https://github.com/abaplint/abaplint/issues/1692). Dropped:
[#3414](https://github.com/abaplint/abaplint/issues/3414) is an ABAP Cloud issue ("Class ... not found/released"),
and ABAP Cloud is not the reference.

Already fixed on `main`, commented 2026-11-23 for the reporter or the maintainer to close. Left to do: comment on
[#4190](https://github.com/abaplint/abaplint/issues/4190) once it is clear what
[PR #4459](https://github.com/abaplint/abaplint/pull/4459) adds; [#3589](https://github.com/abaplint/abaplint/issues/3589)
(screenshot only) not commented.

Diagnostics only (no effect on what is accepted):
- [ ] [#2267](https://github.com/abaplint/abaplint/issues/2267) a statement that does not parse inside a method gives
  "Expected ENDMETHOD" at the start of the class, far from the real error; the maintainer points to the structure
  rewrite [#1975](https://github.com/abaplint/abaplint/issues/1975), so probably large

### Rules that replace the syntax check

Found 2026-11-23. Some findings that ABAP gives as syntax errors come from rules, not from check_syntax: they can be
switched off, and code that uses SyntaxLogic directly (e.g. downport) does not see them. Such checks belong in
check_syntax. abap2go already turns on unknown_types, implement_methods and begin_end_names next to check_syntax
(`src/validation.ts`), so for those three the gain is consistency. Inventory done: on a snippet for each,
check_syntax alone reports nothing and the rule reports it. ABAP is expected to give an error for:
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
  settled in review before the rest follow, once [#4690](https://github.com/abaplint/abaplint/issues/4690) is
  answered. Suggested first: identical_form_names or superclass_final (small, self-contained)
- note: our own PRs [#4633](https://github.com/abaplint/abaplint/pull/4633) (open, parked) and
  [#4636](https://github.com/abaplint/abaplint/pull/4636) (merged) report through unknown_types; once the approach is
  agreed, they move too

### Non-Unicode-only syntax

Found 2026-11-22. abaplint has no notion of non-Unicode programs: no config setting, the UCCHECK flag of the program
is not read. The grammar accepts old and modern forms together, while the syntax check assumes Unicode (e.g. byte
lengths in `_check_database_work_area.ts`). In modern ABAP every program is Unicode, so non-Unicode-only forms are
expected to be syntax errors; abaplint accepts several of them, for every `syntax.version`. Following ABAP, this
belongs in the parser / check_syntax, not in a rule option.

**Waiting for the maintainer** (asked 2026-11-26 in
[a comment on #4753](https://github.com/abaplint/abaplint/issues/4753#issuecomment-7196231659)): either non-Unicode-only
forms are errors everywhere, or the Unicode flag of the program (UCCHECK) or a config setting decides, with Unicode as
the default. No fix and no further issue here before the answer.

- [ ] [#4753](https://github.com/abaplint/abaplint/issues/4753) `OPEN DATASET f.` without `FOR ...` or
  `IN ... MODE`; with no addition at all it parses since
  [66bfba641](https://github.com/abaplint/abaplint/commit/66bfba641)
  ([PR #3571](https://github.com/abaplint/abaplint/pull/3571)), which adds a test for it
- [ ] also accepted, named in the comment: `DESCRIBE FIELD ... LENGTH` and `DESCRIBE DISTANCE` without
  `IN ... MODE`, and an offset/length that reaches past the character-like start of a structure. Already errors:
  `CONCATENATE` of byte-like fields without `IN BYTE MODE`, and `TRANSLATE ... CODE PAGE` (does not parse)
- [ ] rest of the inventory: work out the expected behaviour of the other non-Unicode-only forms, compare with
  abaplint
