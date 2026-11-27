# abaplint roadmap

The work abap2go does in [abaplint](https://github.com/abaplint/abaplint) (parser, check_syntax): a line of work of
its own, next to the compiler's in [compiler_roadmap.md](compiler_roadmap.md). This file is the source of its status:
what to pick up next, in order, and why. Issue and PR numbers belong to abaplint/abaplint and link there. Open issues
and PRs are listed by `gh issue list -R abaplint/abaplint --author @me` and
`gh pr list -R abaplint/abaplint --author @me`; this file records their priority and what they mean for abap2go, not a
copy of their state.

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
- of the list processor's statements only `WRITE` is in scope, as in the compiler
  ([compiler_roadmap.md](compiler_roadmap.md), "Purpose"): issues about `ULINE`, `SKIP`, `NEW-LINE`, `FORMAT`,
  `TOP-OF-PAGE` and the others are not picked up or raised. Of `WRITE`, only strings are (2026-11-27): issues about its
  positions and lengths, its formatting additions, `WRITE … TO` and the output lengths of dictionary types are not
  picked up or raised either
- **abap2go does not reimplement the syntax check** ([aot_for_abap.md](aot_for_abap.md), "No syntax check of its
  own"): the compiler's code assumes valid ABAP, and invalid syntax that abap2go identifies is fixed here, never
  checked in the compiler instead
- what the compiler runs into, within the scope it compiles, is fixed right away, before the other work
- after that, valid ABAP that abaplint mistypes, fails to parse or rejects comes before invalid ABAP that it
  accepts: the compiler's types come from abaplint, so a mistyped expression becomes wrong native code, and its
  input is code that already activates

## How a fix gets in

### Principle

abap2go's own development comes first; upstream PRs are a bonus. A fix goes into abap2go the day it is written,
whether upstream has taken it or not, since there is little upstream activity on the syntax check to wait for.
Upstream gets the same fixes as a queue of small PRs, one issue (or a few close ones) each, at the maintainer's pace.
Upstream's own improvements reach abap2go with a newer release, when the pin moves.

### The patch

`@abaplint/core` is pinned to an upstream release, and `patch-package` applies `patches/@abaplint+core+<version>.patch`
on `npm install`. `scripts/abaplint-patch.sh <abaplint checkout>` builds that patch: it checks out the release tag in
a scratch worktree and merges into it

1. every upstream PR by the author that the release does not contain: open (draft or not), or merged but not
   released, in PR number order, fetched from `abaplint/abaplint`, then
2. every open PR on the author's fork `arcanist123/abaplint`, the waiting PRs, in PR number order, fetched from the
   fork.

It runs abaplint's tests on the result and writes the patch from the files that differ, and the list of what went in
to `patches/abaplint-prs.txt`: `abaplint#N` for upstream PRs, `arcanist123/abaplint#N` for waiting PRs. It stops when
a PR does not merge cleanly or the tests fail. A PR closed without a merge, upstream or on the fork, is left out. Each
PR drops out of the patch by itself once a release contains it.

### Two kinds of PRs

**Upstream PRs** (`abaplint/abaplint`) are what the maintainer reviews and merges. Each one is branched from upstream
`main` and contains only its own commits. No stacked PRs: the maintainer does not take a PR whose branch builds on
another open one, and sets it to draft (#4761). An upstream PR is never moved to the fork, whatever its state.

**Waiting PRs** (`arcanist123/abaplint`) hold fixes that cannot go upstream yet because they need the code of an open
upstream PR: the same file, its helpers, or its tests. A waiting PR

- has a branch of its own as head, and as base the branch it builds on (the upstream PR's branch, or the head of
  another waiting PR), so its diff shows only its own change. A base of `main` would show the whole stack
- is **never merged on the fork**: the fork's `main` mirrors upstream. The PR only keeps the change, its diff, its
  review and its turn; it is closed when its upstream PR is opened
- says in its body that it is a waiting PR, what it builds on and which issues it fixes, worded as for upstream
- is listed in "Waiting PRs on the fork" below, in the order it goes up

Waiting PRs merge cleanly into the patch after the upstream PRs, as each one contains the branch it builds on.

### Steps for a fix

1. Work out the expected behaviour, and raise an issue.
2. Is the code it needs on upstream `main` already, with no open PR changing the same code?
   - yes: branch from upstream `main`
   - no: branch from the branch of the open PR it builds on (the last one in the queue for that code)
3. Write the fix and its tests, run abaplint's tests (see "Testing in abaplint"), push the branch to the fork.
4. Open the PR:
   - branched from `main`: upstream, saying `closes #N` for the issues it fixes
   - branched from another PR's branch: a waiting PR on the fork with that branch as base; add it to "Waiting PRs on
     the fork"
5. Regenerate the patch with `scripts/abaplint-patch.sh`, run `npm test` here, and commit the patch,
   `abaplint-prs.txt` and the roadmap together.

### When a waiting PR goes up

Once the PR it builds on is merged upstream:

1. Rebase its branch onto upstream `main` so that only its own commits are left
   (`git rebase --onto upstream/main <old base> <branch>`), run abaplint's tests again, force-push to the fork.
2. Open the upstream PR from that branch, saying `closes #N`.
3. Close the waiting PR with a link to the upstream one.
4. The waiting PRs on top of it keep the same base branch name, so GitHub shows them against the rebased branch;
   rebase each one too when its diff shows more than its own change.
5. Update "Waiting PRs on the fork" and the issue entries, and regenerate the patch.

One waiting PR goes up at a time per chain, in the order listed; independent chains go up independently.

### When upstream changes or rejects a PR

- **changes asked in review**: they go onto the PR's branch, and regenerating the patch takes its new head. Waiting
  PRs on top of it are rebased onto the new head, and fixed if the change touches them
- **rejected** (closed without a merge): the patch would lose it, so it is opened again as a waiting PR on the fork
  with base `main`, and stays part of abap2go's abaplint. The waiting PRs on top of it keep their base
- **fixed upstream another way**: the conflict shows when abap2go moves to a newer release, and our version is closed
  then

### Moving to a newer release

Set the new exact version in `package.json`, run `npm install`, then the script. PRs and waiting PRs that the release
contains drop out by themselves; one that conflicts with the release is rebased, or closed when the release fixes the
same case. Then `npm test` here.

### Working with upstream

The maintainer (larshp) reviews and merges. Do not merge `main` into an open PR or press
"Update branch" unless GitHub shows a conflict or the maintainer asks: an out-of-date branch is fine, and an update
restarts CI and races with his merges. A PR may close other people's issues through `closes #N`, but other people's
issues are never closed by hand: for one that is already fixed, comment with the evidence (PR, test) and let the
reporter or the maintainer close it. Our own issues we close ourselves, also when one turns out to be raised in
error.

### Testing in abaplint

`npm test`/`--parallel` gives 25-37 "statement type" failures, all 250ms timeouts under load,
and a timeout skips the rest of that file. Serial:
`npx mocha --no-config --no-package --recursive build/test/abap/syntax` (the package.json `spec` overrides a folder
argument otherwise).

## Now: what abap2go has run into

Reviewed 2026-11-26 against abaplint `main` `fc504b57`: every open issue in this file still behaves on `main` as it
describes.

Nothing in abaplint blocks the compiler's current scope (2026-11-26), so the compiler's own work comes next
([compiler_roadmap.md](compiler_roadmap.md), "Next"). Open abaplint issues beyond that scope wait for the compiler step
that needs them (see "Later"). Alongside: keep the patch current, and send up the waiting PRs as
[PR #4741](https://github.com/abaplint/abaplint/pull/4741), which four changes wait for, and then
[PR #4761](https://github.com/abaplint/abaplint/pull/4761) are merged.

Valid code rejected: nothing open that abap2go has run into. The last case, a static offset or length beyond a `c` or
`x` field while the other one is a variable (`c+5(off)`, `c+off(6)` with `c TYPE c LENGTH 5`,
[#4742](https://github.com/abaplint/abaplint/issues/4742)), is fixed by
[PR #4759](https://github.com/abaplint/abaplint/pull/4759), in 2.120.121: ABAP is expected to accept it and to decide
at run time (`CX_SY_RANGE_OUT_OF_BOUNDS`), while a constant counts as static. The compiler's own check still refuses
`c+5(off)`, a follow-up in [compiler_roadmap.md](compiler_roadmap.md), "Next".

[#4726](https://github.com/abaplint/abaplint/issues/4726) is fixed by
[PR #4727](https://github.com/abaplint/abaplint/pull/4727), in 2.120.121.

Valid code mistyped: nothing open. The last case, a number literal beyond the range of `i` typed `i`
([#4736](https://github.com/abaplint/abaplint/issues/4736)), is fixed by
[PR #4737](https://github.com/abaplint/abaplint/pull/4737), in 2.120.121: such a literal is expected to be a `p`
without decimals, of length 8 for up to 15 digits (leading zeros not counted) and length 16 above. The compiler types
number literals itself, with the same lengths.

### Invalid syntax to fix, without a check in the compiler

Found 2026-11-26, with 2.120.120 and the patch.

- [ ] [#4747](https://github.com/abaplint/abaplint/issues/4747) an arithmetic expression after `WHEN` (`WHEN a + 1`,
  `WHEN ipow( base = a exp = 2 )`, `WHEN abs( a + 0 )`) is accepted, while ABAP is expected to allow only a data
  object or a built-in function of one there. The build still refuses them, as operands it does not compile. Fix in
  [PR #4761](https://github.com/abaplint/abaplint/pull/4761), set to draft by the maintainer since it was stacked on
  [PR #4741](https://github.com/abaplint/abaplint/pull/4741) (see "Waiting PRs on the fork"); in the patch. It also
  rejects `abs( ( b ) )` and `abs( val = b )` after `WHEN`
- [ ] [#4748](https://github.com/abaplint/abaplint/issues/4748) `CASE ( a ).` and `WHEN ( b ).`, parentheses around a
  single operand (also `( abs( a ) )`, `( ( a ) )`, `( sy-index )`), are accepted, while ABAP is expected to reject
  them; the compiler compiles `CASE ( a ).` as without them. `CASE ( a + 1 ).` is valid. Fixed in waiting PR
  [arcanist123/abaplint#1](https://github.com/arcanist123/abaplint/pull/1), in the patch: after `CASE` parentheses only
  around a calculation (an arithmetic or bit expression, or a numeric built-in function of a calculated argument,
  `( abs( a + 1 ) )`), after `WHEN` none. Not covered: parentheses inside a string expression after `CASE`,
  `( c ) && s`, part of [#4771](https://github.com/abaplint/abaplint/issues/4771)
- [ ] [#4749](https://github.com/abaplint/abaplint/issues/4749) parentheses around a single operand as the argument
  of `strlen( )`, or of `abs( )` in a comparison, are accepted, while ABAP is expected to reject them
  (`i = abs( ( i ) ).` is valid). Fixed in two parts, both in the patch:
  - [PR #4768](https://github.com/abaplint/abaplint/pull/4768), merged, not released: no parentheses in a
    character-like, byte-like, table or `utclong` argument of a built-in function, also inside `&&`. Not covered: `bit`
    of `boolx( )` ([#4770](https://github.com/abaplint/abaplint/issues/4770)). `sep` of `from_mixed( )` is covered
    since [PR #4773](https://github.com/abaplint/abaplint/pull/4773) (see "Backlog"). After `WHEN`, `strlen( ( s ) )`
    is reported twice, also by #4761
  - waiting PR [arcanist123/abaplint#3](https://github.com/arcanist123/abaplint/pull/3): in a comparison, a `WHERE`
    condition and after `CASE`, no parentheses around a data object as the argument of a numeric function, unless an
    operand of the comparison is calculated (`IF abs( ( i ) ) = j + 1.` is valid)
- [x] [#4750](https://github.com/abaplint/abaplint/issues/4750) a parameter name for the argument of `abs( )`,
  `abs( val = i )`, was accepted. Fixed by [PR #4767](https://github.com/abaplint/abaplint/pull/4767), merged, not
  released, in the patch: the same for every built-in function with one unnamed argument (`strlen( )`, `lines( )`,
  `sqrt( )` and the others), except `boolc( )`, whose argument is a logical expression. After `WHEN`, `abs( val = b )`
  is reported twice, also by #4761
- [ ] [#4762](https://github.com/abaplint/abaplint/issues/4762) after `WHEN`, `&&`, string templates, built-in
  functions with a character-like result (`condense( )`, `to_upper( )`, `substring( )`, `boolc( )`, `xsdbool( )`),
  bit expressions and table expressions (`tab[ 1 ]`) are accepted, while ABAP is expected to reject them. The same
  forms after `CASE`, `'a' & 'b'` and an expression inside a constructor expression are valid. Fixed in waiting PR
  [arcanist123/abaplint#2](https://github.com/arcanist123/abaplint/pull/2), on top of `case-parentheses-4748`, in the
  patch: after `WHEN` no string, bit or table expression, and no built-in function with a non-numeric result. Not
  covered: `bit-set( )` and `boolx( )`, which did not parse at all ([#4764](https://github.com/abaplint/abaplint/issues/4764)).
  With [PR #4766](https://github.com/abaplint/abaplint/pull/4766) they parse as their own forms in `Source`, not as
  method calls, so the check after `WHEN` does not see them and accepts them
  - [ ] follow-up once #2 is upstream (#4766 is merged): reject `bit-set( )` and `boolx( )` after `WHEN`
- [x] [#4771](https://github.com/abaplint/abaplint/issues/4771) parentheses around a single operand as an operand of
  `&&` (also after `CASE`), as the embedded expression of a string template, in a constructor expression (`CONV`, a
  `VALUE` row, `THEN`, `ELSE`, `NEXT`) and as the source of `APPEND` and `INSERT` were accepted, while ABAP is expected
  to reject them. `s = ( s ).`, `|{ ( i + 1 ) }|` and `APPEND ( i + 1 ) TO itab.` are valid. The compiler reads
  parentheses around a single data object as nothing (`unparenthesized` in `src/lower_arith.ts`), so it relies on
  abaplint here. Fixed by [PR #4774](https://github.com/abaplint/abaplint/pull/4774), merged, not released, in the
  patch. Not covered: `NEW` ([#4775](https://github.com/abaplint/abaplint/issues/4775)), `MODIFY`, `COLLECT`, `READ TABLE` and
  `DELETE TABLE` ([#4776](https://github.com/abaplint/abaplint/issues/4776)), see "Later"

### Waiting PRs on the fork

Fixes that need the code of an open upstream PR (see "How a fix gets in"): open PRs on
[arcanist123/abaplint](https://github.com/arcanist123/abaplint/pulls), never merged there, all in the patch. Listed by
`gh pr list -R arcanist123/abaplint`; in order, each chain from the bottom up.

Chain on `when.ts`, which starts going up once [PR #4741](https://github.com/abaplint/abaplint/pull/4741) is merged:

| Order | PR | Branch | Base | Fixes |
|---|---|---|---|---|
| 1 | [abaplint#4761](https://github.com/abaplint/abaplint/pull/4761) (upstream, draft) | `case-when-arithmetic-4747` | upstream `main`, still with the #4741 commits | [#4747](https://github.com/abaplint/abaplint/issues/4747) |
| 2 | [arcanist123/abaplint#1](https://github.com/arcanist123/abaplint/pull/1) | `case-parentheses-4748` | `case-when-arithmetic-4747` | [#4748](https://github.com/abaplint/abaplint/issues/4748) |
| 3 | [arcanist123/abaplint#2](https://github.com/arcanist123/abaplint/pull/2) | `when-string-bit-table-4762` | `case-parentheses-4748` | [#4762](https://github.com/abaplint/abaplint/issues/4762) |
| 4 | [arcanist123/abaplint#3](https://github.com/arcanist123/abaplint/pull/3) | `comparison-argument-parentheses-4749` | `when-string-bit-table-4762` | [#4749](https://github.com/abaplint/abaplint/issues/4749), the rest after #4768 |

#4761 was opened stacked before this rule, so it stays the upstream draft rather than move to the fork: once #4741 is
merged, rebase it onto `main` (which drops the #4741 commit) and mark it ready. Once #4761 is merged, #1 goes up as in
"When a waiting PR goes up", #2 once #1 is merged, and #3 once #2 is merged. #4768 only says "part of #4749", so the
upstream PR from #3 says `closes #4749`.

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
  [PR #4740](https://github.com/abaplint/abaplint/pull/4740), in 2.120.121)
- a comparison of kinds without a comparison type, `d = t` or `utclong = i`
  ([#4728](https://github.com/abaplint/abaplint/issues/4728)), and a non-numeric operand compared with an arithmetic
  expression ([#4738](https://github.com/abaplint/abaplint/issues/4738);
  both [PR #4741](https://github.com/abaplint/abaplint/pull/4741), in the patch)

Removed that day, since it was no syntax error: a `TRY` without `CATCH` or `CLEANUP` is expected to give only a
warning. [#4724](https://github.com/abaplint/abaplint/issues/4724), which asked abaplint to report it, is closed.

Removed 2026-11-27, since abaplint reports it:
- in a class, `CASE` without any `WHEN`, or with statements before the first one
  ([#4744](https://github.com/abaplint/abaplint/issues/4744),
  [PR #4784](https://github.com/abaplint/abaplint/pull/4784), in the patch). A macro call, an `INCLUDE` or an
  enhancement before the first `WHEN` is not reported, as it might supply the `WHEN`; the compiler supports none of
  these in a class

abaplint accepts these, so the fix goes into abaplint. #4730, #4745 and #4746 change the same code
(`_substring.ts`) as the merged [PR #4759](https://github.com/abaplint/abaplint/pull/4759): branch from a `main` that
has it.
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
- [ ] [#4745](https://github.com/abaplint/abaplint/issues/4745) a subfield of a `utclong` in a reading position,
  `s = u+1(1)` (`src/lower_common.ts`)
- [ ] [#4746](https://github.com/abaplint/abaplint/issues/4746) static bounds outside a flat field of type `n`, `d`
  or `t`, `d+8`, `n(5)` (`src/lower_common.ts`)

## Later: with the compiler step that needs it

The compiler steps are in [compiler_roadmap.md](compiler_roadmap.md), "Next". When a step starts, its valid ABAP comes
first.

Valid ABAP that abaplint mistypes, fails to parse or rejects:

| Issue | What | Pick up with |
|---|---|---|
| [#4756](https://github.com/abaplint/abaplint/issues/4756) | a literal passed to a parameter of the generic type `p` is reported as not compatible: valid code rejected | method calls with parameters |
| [#4754](https://github.com/abaplint/abaplint/issues/4754) | `NEW lcl( )->attr = 1.` gives "Not an object reference, target" for any attribute | objects and `NEW` |
| [#4779](https://github.com/abaplint/abaplint/issues/4779) | `NEW` with `LET`, `FOR`, `BASE`, `LINES OF` or default components in front of table rows does not parse | objects and `NEW` |
| [#4687](https://github.com/abaplint/abaplint/issues/4687) | `CORRESPONDING`: `APPENDING`, `EXACT`, lookup table and `MAPPING ... DEFAULT` not parsed (nested `MAPPING` is merged, [PR #4688](https://github.com/abaplint/abaplint/pull/4688)) | structures and `CORRESPONDING` |
| [#4755](https://github.com/abaplint/abaplint/issues/4755) | `INSERT itab.`, the short form for a table with a header line, parses as InsertDatabase (context-free parser). Putting it in the InsertInternal grammar is a design question for the abaplint maintainer | tables with a header line, if they are compiled |

Invalid ABAP that abaplint accepts:

| Issue | What | Pick up with |
|---|---|---|
| [#4712](https://github.com/abaplint/abaplint/issues/4712) | the literal of a `VALUE` addition that does not convert to a numeric type (`DATA i TYPE i VALUE 'abc'.`, a number outside the range) is accepted. A move of such a literal (`i = 'abc'.`) is expected to give only a warning: valid code, the conversion fails at run time | `CONSTANTS` and `DATA … VALUE` with static operands |
| [#4642](https://github.com/abaplint/abaplint/issues/4642) | an assignment between flat structures with non-matching fragment views is accepted | structure assignments |
| [#4772](https://github.com/abaplint/abaplint/issues/4772) | parentheses around an actual parameter of a method are accepted when the formal parameter is character-like, a date, a table or of type `data`; with a numeric parameter they are valid | method calls with parameters |
| [#4775](https://github.com/abaplint/abaplint/issues/4775) | parentheses around a single operand in `NEW`. A check has to cover the forms of [#4779](https://github.com/abaplint/abaplint/issues/4779) too once they parse | objects and `NEW` |
| [#4776](https://github.com/abaplint/abaplint/issues/4776) | parentheses around the work area of `MODIFY`, `COLLECT`, `READ TABLE` and `DELETE TABLE`, and a calculation there for the last three | internal tables |
| [#4780](https://github.com/abaplint/abaplint/issues/4780) | a built-in function as the work area of `COLLECT`, `READ TABLE` and `DELETE TABLE` | internal tables |
| [#4777](https://github.com/abaplint/abaplint/issues/4777) | parentheses around a single operand as the whole source of an inline declaration | inline declarations |
| [#4778](https://github.com/abaplint/abaplint/issues/4778) | parentheses around a string expression or a string template | `&&` and string templates |
| [#4785](https://github.com/abaplint/abaplint/issues/4785) | in a class, `CASE TYPE OF` without any `WHEN`, or with `DATA` before the first one, is accepted; outside classes only a warning is expected. It builds on the check of [PR #4784](https://github.com/abaplint/abaplint/pull/4784), so a waiting PR on `case-without-when-4744` while that is open | objects and `CASE TYPE OF` |

## Parked

Nothing in the compiler's scope needs these yet.

- [ ] [PR #4633](https://github.com/abaplint/abaplint/pull/4633) `METHODS` see only the types defined above them
  ([#2556](https://github.com/abaplint/abaplint/issues/2556)), until the compiler compiles classes. A draft since
  2026-11-26, changes requested:
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
- [ ] out of scope since `WRITE` takes strings only (2026-11-27); raised before, left open upstream, not worked on:
  - [#4703](https://github.com/abaplint/abaplint/issues/4703) `sy` components have no type name, so
    `TYPE sy-datum` cannot be told from `TYPE d`. The data elements are expected to be `SYST_<component>` with
    their own output lengths (`SYST_DATUM` 10). Reopen if RTTI of `sy` components needs it
  - [#4783](https://github.com/abaplint/abaplint/issues/4783) `WRITE` with a blank between `/` and a number or
    `(length)` (`WRITE / 5.`, `WRITE / (10) moo.`), expected to be an error: `/`, position and length are one word

Closed as raised in error (2026-11-26), kept here so they are not raised again: a number literal of type `i` passed
to a `p` parameter with decimals is valid ([#4751](https://github.com/abaplint/abaplint/issues/4751)); an unsupported
HTML tag in ABAP Doc is expected to give warnings only ([#4655](https://github.com/abaplint/abaplint/issues/4655)).

## In the patch

PRs that the pinned release, 2.120.121, does not contain, as of 2026-11-27. The patch also holds waiting PRs
arcanist123/abaplint#1 to #3, which are not in this table (see "Waiting PRs on the fork").

| PR | What | State |
|---|---|---|
| [#4631](https://github.com/abaplint/abaplint/pull/4631) | INT1 and INT2 keep their size ([#4630](https://github.com/abaplint/abaplint/issues/4630)); the compiler declares `b` and `s` through data elements | open |
| [#4633](https://github.com/abaplint/abaplint/pull/4633) | `METHODS` see only the types defined above them ([#2556](https://github.com/abaplint/abaplint/issues/2556)) | draft, changes requested, parked (see "Parked") |
| [#4635](https://github.com/abaplint/abaplint/pull/4635) | a write to a `READ-ONLY` attribute from outside the class ([#2097](https://github.com/abaplint/abaplint/issues/2097)). It also covers [#2611](https://github.com/abaplint/abaplint/issues/2611): add `closes #2611` to the PR, or comment on #2611 after the merge | open |
| [#4684](https://github.com/abaplint/abaplint/pull/4684) | `\|` and `}` in EXEC SQL or an AMDP body taken as a string template, valid code mis-lexed ([#4329](https://github.com/abaplint/abaplint/issues/4329)) | open |
| [#4739](https://github.com/abaplint/abaplint/pull/4739) | `RETRY` outside a `CATCH` block is an error ([#4723](https://github.com/abaplint/abaplint/issues/4723)) | open |
| [#4741](https://github.com/abaplint/abaplint/pull/4741) | comparisons without a comparison type, also after `WHEN`, and calculations compared with non-numeric operands are errors ([#4728](https://github.com/abaplint/abaplint/issues/4728), [#4738](https://github.com/abaplint/abaplint/issues/4738)) | open |
| [#4761](https://github.com/abaplint/abaplint/pull/4761) | an arithmetic expression or a calculating built-in function after `WHEN` is an error ([#4747](https://github.com/abaplint/abaplint/issues/4747)) | draft, waits for #4741 |
| [#4766](https://github.com/abaplint/abaplint/pull/4766) | `bit-set( )` and `boolx( bool = <logical expression> )` parse, typed `xstring` ([#4764](https://github.com/abaplint/abaplint/issues/4764)) | merged, not released |
| [#4767](https://github.com/abaplint/abaplint/pull/4767) | a parameter name for the argument of a built-in function with one unnamed argument, `abs( val = i )`, is an error ([#4750](https://github.com/abaplint/abaplint/issues/4750)) | merged, not released |
| [#4768](https://github.com/abaplint/abaplint/pull/4768) | parentheses in a character-like, byte-like, table or `utclong` argument of a built-in function are an error (part of [#4749](https://github.com/abaplint/abaplint/issues/4749)) | merged, not released |
| [#4773](https://github.com/abaplint/abaplint/pull/4773) | `sep` of `from_mixed( )` is character-like ([#4769](https://github.com/abaplint/abaplint/issues/4769)) | merged, not released |
| [#4774](https://github.com/abaplint/abaplint/pull/4774) | parentheses around a single operand of `&&`, in a string template, a constructor expression and the source of `APPEND` and `INSERT` are an error ([#4771](https://github.com/abaplint/abaplint/issues/4771)) | merged, not released |
| [#4784](https://github.com/abaplint/abaplint/pull/4784) | in a class, `CASE` without any `WHEN`, or with statements before the first one, is an error ([#4744](https://github.com/abaplint/abaplint/issues/4744)) | open |

Released and out of the patch:
- in 2.120.121: [PR #4716](https://github.com/abaplint/abaplint/pull/4716) (`NOT NOT`,
  [#4714](https://github.com/abaplint/abaplint/issues/4714)), [PR #4727](https://github.com/abaplint/abaplint/pull/4727)
  (`d` against a result of type `i`, [#4726](https://github.com/abaplint/abaplint/issues/4726)),
  [PR #4737](https://github.com/abaplint/abaplint/pull/4737) (number literals beyond `i`,
  [#4736](https://github.com/abaplint/abaplint/issues/4736)), [PR #4740](https://github.com/abaplint/abaplint/pull/4740)
  (`CATCH` of a non-exception, [#4725](https://github.com/abaplint/abaplint/issues/4725)),
  [PR #4758](https://github.com/abaplint/abaplint/pull/4758) (`SPLIT ... IN BYTE MODE`,
  [#4757](https://github.com/abaplint/abaplint/issues/4757)), [PR #4759](https://github.com/abaplint/abaplint/pull/4759)
  (substring bounds with a variable, [#4742](https://github.com/abaplint/abaplint/issues/4742))
- in 2.120.119: `WRITE` of a utclong ([#4700](https://github.com/abaplint/abaplint/issues/4700),
  [PR #4701](https://github.com/abaplint/abaplint/pull/4701)), which the compiler now compiles

## Backlog

Not run into by abap2go. All 380 open issues were read on 2026-11-23, and the parser / check_syntax ones run through
abaplint (main `af7440a`, default config, `v757`).

### Valid ABAP mistreated

- [ ] **[#1809](https://github.com/abaplint/abaplint/issues/1809)** a macro of the same name in two methods: the
  second call expands the first definition, `"foo" not found`; macros need scoping by position (keyword
  documentation: a macro is valid from its DEFINE onward). Valid code is expanded wrongly
- [x] [#4757](https://github.com/abaplint/abaplint/issues/4757) `SPLIT ... IN BYTE MODE`: byte-like targets are
  rejected and inline targets are typed `string` instead of `xstring` (character targets are accepted, though an error
  is expected). Fixed by [PR #4758](https://github.com/abaplint/abaplint/pull/4758), in 2.120.121
- [x] [#4769](https://github.com/abaplint/abaplint/issues/4769) `from_mixed( val = s sep = c )` with a variable of type
  `c` was reported as not compatible, `sep` being typed as an integer, while `sep = 1` and `sep = i`, where an error is
  expected, were accepted. Found 2026-11-26 while fixing #4749. Fixed by
  [PR #4773](https://github.com/abaplint/abaplint/pull/4773), merged, not released, in the patch
- [x] [#4764](https://github.com/abaplint/abaplint/issues/4764) `bit-set( 1 )` and `boolx( bool = i = 1 )` do not
  parse: `bit-set` is lexed as `bit`, `-`, `set`, and the logical expression of `boolx( )` is not handled the way
  `boolc( )` and `xsdbool( )` are in `Source`. Found 2026-11-26 while fixing #4762; valid code that fails to parse.
  Fixed by [PR #4766](https://github.com/abaplint/abaplint/pull/4766), in the patch: both are their own forms in
  `Source`, typed `xstring`. `boolx( bool = abap_true )`, no logical expression, still parses as a method call

### Invalid ABAP accepted

No error from check_syntax where ABAP is expected to give one:
- [ ] **[#2088](https://github.com/abaplint/abaplint/issues/2088)** rest: assignment to an IMPORTING (by reference)
  parameter or a constant is reported; `SORT itab`, `APPEND ... TO itab` and `CLEAR text` on IMPORTING parameters
  are not. Overlaps [#2097](https://github.com/abaplint/abaplint/issues/2097) /
  [PR #4635](https://github.com/abaplint/abaplint/pull/4635) (write positions); do it together with
  [PR #4635](https://github.com/abaplint/abaplint/pull/4635)
- [ ] [#4770](https://github.com/abaplint/abaplint/issues/4770) `bit` of `boolx( )` takes a calculation, parentheses, a
  built-in function, a constructor or a table expression, while ABAP is expected to allow only a data object. Found
  2026-11-26 while fixing #4749
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
- [ ] the value of a constant as offset or length is not evaluated: `c+lc_off` or `c+2(lc_len)` reaching beyond the
  field is expected to be an error (not raised; the test "ok, offset given by a constant" expects none). With
  [PR #4759](https://github.com/abaplint/abaplint/pull/4759), `c+5(ref->lc_len)`, a constant behind `->`, is
  accepted too, as if it were a variable

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
