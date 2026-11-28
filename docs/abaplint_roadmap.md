# abaplint roadmap

The work abap2go does in [abaplint](https://github.com/abaplint/abaplint) (parser, check_syntax): a line of work of
its own, next to the compiler's in [compiler_roadmap.md](compiler_roadmap.md). This file is the source of its status:
what to pick up next, in order, and why. A bare issue or PR number (`#N`) belongs to abaplint/abaplint and links
there; issues and PRs on the fork are written `arcanist123/abaplint#N`. Open issues and PRs are listed by
`gh issue list -R arcanist123/abaplint`, `gh issue list -R abaplint/abaplint --author @me` and
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
- **the syntax check has two layers** (2026-11-27, see "Two layers" below): abaplint is layer 1, abap2go's own
  checks are layer 2. Work here is layer 1 only: valid ABAP that abaplint fails to parse, rejects or mistypes, and
  a concrete syntax tree that abaplint builds wrongly, for valid or invalid code. Invalid ABAP that abaplint parses
  into the right tree but accepts is checked in layer 2, in abap2go, and is not raised or fixed here any more
- what the compiler runs into, within the scope it compiles, is fixed right away, before the other work: the
  compiler's types come from abaplint, so a mistyped expression becomes wrong native code

## Two layers

Decided 2026-11-27.

**Layer 1: abaplint, as released.** Its parser, check_syntax and types are taken as they are, from the pinned
release and the patch. What it reports is accepted as reported. Raised and fixed here, and sent upstream:
- valid ABAP that does not parse
- valid ABAP that check_syntax rejects
- valid ABAP that is typed wrongly: a wrong built-in type, a lost length or size, `VoidType` where a type is known,
  or no types and references at all, where the syntax check skips a statement
- a concrete syntax tree built wrongly, for valid or invalid code: a statement or expression parsed as the wrong
  node, or with its parts in the wrong place. Layer 2 and the compiler both read the tree, so it has to describe the
  code as ABAP reads it; a check in layer 2 cannot make up for a wrong tree

A type fix is kept as small as it can be and
comes with what keeps valid code valid; it does not add checks of its own. The patch holds such fixes only until a
release has them. Layer 1 must be right first: on the first error in a block, check_syntax stops typing the rest of
that block, so where abaplint rejects valid code, layer 2 does not see the code after it.

**Layer 2: abap2go's own checks**, in `src/check/` (see [compiler_roadmap.md](compiler_roadmap.md)). They run after
abaplint's checks, on its syntax tree, scopes and types, through its public API only, and report in its `Issue`
format. They cover:
- invalid ABAP that abaplint accepts
- the rules of Unicode programs that abaplint does not apply: abaplint does not read the Unicode flag (`UCCHECK`).
  A program without the flag is refused by the scope pass, not by layer 2 (see
  [aot_for_abap.md](aot_for_abap.md), "Four kinds of refusal")
- the value ranges, overflow and sizes of the internal types `b` and `s` (`INT1`, `INT2`), once layer 1 gives the
  size (see [#4631](https://github.com/abaplint/abaplint/pull/4631))
- the absolute position of code expanded from a macro: abaplint lexes an expanded macro as new text, so its tokens
  only carry the position of the call

### Valid code that abaplint rejects

This cannot be handled in layer 2. abap2go does not ignore or filter out an abaplint finding: check_syntax stops
typing the block at its first error, so the code after it has no types, and the compiler would build from a
partial picture. Such a case is therefore always fixed in layer 1, and comes before every other layer 1 fix:
1. the case goes into abap2go's tests at once, with the abaplint issue linked, expecting the build to refuse it
   with abaplint's finding as long as abaplint gives one
2. the fix goes into the patch the day it is written, and the same fix goes upstream as a PR branched from `main`.
   The test then expects the code to build
3. a fix that needs the code of another open PR is the one case where a waiting PR on the fork is still opened, so
   that the patch has it at once (see "Two kinds of PRs")
4. if the maintainer prefers another approach, the fix follows his review. If he declines it, or a fix is too large
   to offer upstream, abap2go carries it in the patch for good, as a waiting PR on the fork with base `main` (see
   "When upstream changes or rejects a PR"), and pays the cost of rebasing it when the pin moves
5. code that only a non-Unicode program allows is not fixed in layer 1: abap2go refuses non-Unicode programs as a
   whole (see layer 2), so abaplint rejecting such code needs no fix

The same holds for valid code that abaplint types wrongly: the compiler takes its types, so the fix is in layer 1,
in the patch at once, and never a correction inside the compiler.

### Layer 2 checks

A layer 2 check is written, tested and changed at abap2go's pace, without an abaplint issue or PR. When an abaplint
release reports the same case in every form, our check goes, and its test then expects abaplint's finding. A layer 2
check can still be offered upstream later, as a single PR, where it may also help abaplint's users.

### Moving over

What is open in this file from before the decision is moved over as follows:
- open upstream PRs stay as they are; the maintainer merges or declines them at his pace
- upstream PRs and waiting PRs that only add checks for invalid code are ported to layer 2, and leave the patch as
  each port lands. Waiting PRs on the fork are then closed, so the chains end
- upstream PRs that mix a type fix and new checks are split: the type fix stays, the checks move to layer 2 (#4832,
  the first such PR, was released whole in 2.120.123 before it was split)
- issues about invalid ABAP that abaplint accepts, upstream and on the fork, stay open and are linked from the layer
  2 check that covers them

## How a fix gets in

### Principle

This section is about layer 1 fixes (see "Two layers"). A fix goes into abap2go the day it is written, through the
patch, whether upstream has taken it or not. Upstream gets the same fixes as small PRs, one issue (or a few close
ones) each, at the maintainer's pace. Upstream's own improvements reach abap2go with a newer release, when the pin
moves. A layer 1 fix rarely needs another open PR; where one does, it is a waiting PR on the fork as below, so that
the patch has it at once. Checks for invalid code are no longer waiting PRs: they go to layer 2.

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

1. Work out the expected behaviour, and raise an issue on the fork (see "Where issues go").
2. Is the code it needs on upstream `main` already, with no open PR changing the same code?
   - yes: branch from upstream `main`
   - no: branch from the branch of the open PR it builds on (the last one in the queue for that code)
3. Write the fix and its tests, run abaplint's tests (see "Testing in abaplint"), push the branch to the fork.
4. Open the PR:
   - branched from `main`: upstream, with the snippets and the expected behaviour in its body, and `closes #N` for
     the upstream issues it fixes. It does not link fork issues
   - branched from another PR's branch: a waiting PR on the fork with that branch as base; add it to "Waiting PRs on
     the fork"
5. Regenerate the patch with `scripts/abaplint-patch.sh`, run `npm test` here, and commit the patch,
   `abaplint-prs.txt` and the roadmap together.

### When a waiting PR goes up

Once the PR it builds on is merged upstream:

1. Rebase its branch onto upstream `main` so that only its own commits are left
   (`git rebase --onto upstream/main <old base> <branch>`), run abaplint's tests again, force-push to the fork.
2. Open the upstream PR from that branch, as in step 4 above.
3. Close the waiting PR with a link to the upstream one.
4. The waiting PRs on top of it keep the same base branch name, so GitHub shows them against the rebased branch;
   rebase each one too when its diff shows more than its own change.
5. Update "Waiting PRs on the fork" and the issue entries, and regenerate the patch.

One waiting PR goes up at a time per chain, in the order listed; independent chains go up independently.

### Where issues go

New issues are raised on the fork, `arcanist123/abaplint` (2026-11-27), not upstream. In the upstream tracker the
issues by the author already outnumber everyone else's, and a fix arrives upstream as a PR that explains itself, so
an upstream issue next to it only adds to the maintainer's queue. The fork's issues are the backlog: public, worded
by the same rules as upstream text, and closed by us when the fix is merged upstream, or as not needed.

- the issues already raised upstream stay there, and PRs keep closing them with `closes #N`
- an issue goes upstream only when it needs the maintainer: a design question (like
  [#4755](https://github.com/abaplint/abaplint/issues/4755)), or a gap we are not going to fix ourselves
- this may change if the maintainer says he would rather have the issues upstream

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

A newer release is also needed when an open PR branch is updated with `main` while the patch still holds merged,
unreleased PRs: the branch then brings in their squashed commits, and the script stops where they meet the original
ones (2026-11-27, at #4768, solved by 2.120.122).

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
describes. PRs and fork issues reviewed again on 2026-11-27.

**Done 2026-11-28: `COMPUTE` upstream** (priority set the same day). abaplint's syntax check skipped the statement,
so valid code in it got no types or references (see "Open, layer 1" under "Syntax checks to move out of the
compiler"). [PR #4844](https://github.com/abaplint/abaplint/pull/4844) adds a `Compute` handler that checks the
statement as the assignment it stands for; merged 2026-11-28, not released yet. abap2go does not wait for it: the
compiler does not compile `COMPUTE` yet, so the patch is not rebuilt for it alone, and the fix comes with the next
release, or the next run of `scripts/abaplint-patch.sh` if that is sooner. The compiler's own items are next
(see [compiler_roadmap.md](compiler_roadmap.md), "Next").

**Done 2026-11-28: the compiler's last syntax checks are in layer 2 or gone** (priority set 2026-11-27, revised the
same day by "Two layers"; see "Syntax checks to move out of the compiler"). Three moved to `src/check/`:
`CONTINUE` outside a loop, static bounds of `n`, `d`, `t`, and more than 31 digits. Three went, since 2.120.123
reports every form the lowering checked: a `utclong` in a calculation, a subfield of a `utclong` and a static
length of 0. The PRs written for them stay open upstream. The waiting PRs
[arcanist123/abaplint#14](https://github.com/arcanist123/abaplint/pull/14) and
[arcanist123/abaplint#21](https://github.com/arcanist123/abaplint/pull/21) are closed (2026-11-28), and no PR is
written for [#4743](https://github.com/abaplint/abaplint/issues/4743) (more than 31 digits).

The lowering has no syntax check left; what it refuses beyond the findings of both layers is what it does not
compile yet. That includes a subfield of a numeric type: `i+0`, `i(*)` and `i(4)`, valid with
[PR #4830](https://github.com/abaplint/abaplint/pull/4830), in 2.120.123, and `p(5)` are refused as not supported
yet, not as syntax errors (2026-11-28).

Valid code mistyped: [arcanist123/abaplint#16](https://github.com/arcanist123/abaplint/issues/16), a data element of
data type `UTCL` typed `c LENGTH 27`, is fixed by [PR #4832](https://github.com/abaplint/abaplint/pull/4832), in
2.120.123.

Open abaplint issues beyond the compiler's scope wait for the compiler step that needs them (see "Later"). The first of those steps is next in line: before the compiler compiles `IS INITIAL`, `IN`
and the string, byte and bit operators, take their operand checks.
[#4799](https://github.com/abaplint/abaplint/issues/4799), [#4800](https://github.com/abaplint/abaplint/issues/4800) and
[#4802](https://github.com/abaplint/abaplint/issues/4802) are fixed and in the patch (2026-11-27, see below); left are
[#4801](https://github.com/abaplint/abaplint/issues/4801) (`IN`) and
[#4806](https://github.com/abaplint/abaplint/issues/4806) (string operators in a `WHERE` condition), see "Later".
Alongside: keep the patch current, and send up the waiting PRs as
[PR #4741](https://github.com/abaplint/abaplint/pull/4741), which seven changes wait for, and then
[PR #4761](https://github.com/abaplint/abaplint/pull/4761) are merged.

Valid code rejected: nothing open that abap2go has run into. The last case, a static offset or length beyond a `c` or
`x` field while the other one is a variable (`c+5(off)`, `c+off(6)` with `c TYPE c LENGTH 5`,
[#4742](https://github.com/abaplint/abaplint/issues/4742)), is fixed by
[PR #4759](https://github.com/abaplint/abaplint/pull/4759), in 2.120.121: ABAP is expected to accept it and to decide
at run time (`CX_SY_RANGE_OUT_OF_BOUNDS`), while a constant counts as static.

[#4726](https://github.com/abaplint/abaplint/issues/4726) is fixed by
[PR #4727](https://github.com/abaplint/abaplint/pull/4727), in 2.120.121.

Valid code mistyped: nothing open. The last case, a number literal beyond the range of `i` typed `i`
([#4736](https://github.com/abaplint/abaplint/issues/4736)), is fixed by
[PR #4737](https://github.com/abaplint/abaplint/pull/4737), in 2.120.121: such a literal is expected to be a `p`
without decimals, of length 8 for up to 15 digits (leading zeros not counted) and length 16 above. The compiler types
number literals itself, with the same lengths.

### Invalid syntax to fix, without a check in the compiler

Found 2026-11-26, with 2.120.120 and the patch. Since 2026-11-27 these belong to layer 2 (see "Two layers"): each
one is ported to a check in `src/check/`, and its fix leaves the patch once the port lands. The entries stay until
then, as the record of what each fix covers.

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
  (`i = abs( ( i ) ).` is valid). Fixed in two parts:
  - [PR #4768](https://github.com/abaplint/abaplint/pull/4768), in 2.120.122: no parentheses in a
    character-like, byte-like, table or `utclong` argument of a built-in function, also inside `&&`. Not covered: `bit`
    of `boolx( )` ([#4770](https://github.com/abaplint/abaplint/issues/4770)). `sep` of `from_mixed( )` is covered
    since [PR #4773](https://github.com/abaplint/abaplint/pull/4773) (see "Backlog"). After `WHEN`, `strlen( ( s ) )`
    is reported twice, also by #4761
  - waiting PR [arcanist123/abaplint#3](https://github.com/arcanist123/abaplint/pull/3), in the patch: in a comparison,
    a `WHERE` condition and after `CASE`, no parentheses around a data object as the argument of a numeric function,
    unless an operand of the comparison is calculated (`IF abs( ( i ) ) = j + 1.` is valid)
- [x] [#4750](https://github.com/abaplint/abaplint/issues/4750) a parameter name for the argument of `abs( )`,
  `abs( val = i )`, was accepted. Fixed by [PR #4767](https://github.com/abaplint/abaplint/pull/4767), in
  2.120.122: the same for every built-in function with one unnamed argument (`strlen( )`, `lines( )`,
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
  abaplint here. Fixed by [PR #4774](https://github.com/abaplint/abaplint/pull/4774), in 2.120.122. Not covered: `NEW`
  ([#4775](https://github.com/abaplint/abaplint/issues/4775)), `MODIFY`, `COLLECT`, `READ TABLE` and `DELETE TABLE`
  ([#4776](https://github.com/abaplint/abaplint/issues/4776)), see "Later"
- [ ] [#4799](https://github.com/abaplint/abaplint/issues/4799) operands of `CO`, `CN`, `CA`, `NA`, `CS`, `NS`, `CP` and
  `NP` that are not character-like (`i CO c`, `c CP 5`) are accepted. Fixed in two waiting PRs, both in the patch:
  - [arcanist123/abaplint#4](https://github.com/arcanist123/abaplint/pull/4): both operands are character-like. On the
    right only, a numeric built-in function of a data object stays valid (`c CO strlen( s )`); the compiler is to refuse
    that form ([spec/comparison.md](spec/comparison.md), "Open points"). Not covered: `WHERE` conditions
    ([#4806](https://github.com/abaplint/abaplint/issues/4806))
  - [arcanist123/abaplint#6](https://github.com/arcanist123/abaplint/pull/6): that function is not valid after a
    character-like expression on the left (`s && s CO strlen( s )`). Not covered: parentheses and other comparison
    operators there, arcanist123/abaplint#7 and #8 (see "Later")
- [ ] [#4800](https://github.com/abaplint/abaplint/issues/4800) operands of `BYTE-…`, `O`, `Z` and `M` that are not
  byte-like (`c BYTE-CO x`, `x O '01'`) are accepted. Fixed in waiting PR
  [arcanist123/abaplint#5](https://github.com/arcanist123/abaplint/pull/5), in the patch, with the same exception for a
  numeric built-in function on the right, here not after a bit expression on the left. Not covered: `WHERE` conditions
  - [ ] follow-up once #5 is on a `main` with #4766: tests for `bit-set( )` and `boolx( )` as bit expressions
- [ ] [#4802](https://github.com/abaplint/abaplint/issues/4802) a calculation before `IS [NOT] INITIAL` is accepted.
  Fixed in [PR #4811](https://github.com/abaplint/abaplint/pull/4811), in 2.120.123: no arithmetic, string or bit
  expression and no string template, also in parentheses; of the built-in functions only the numeric and length
  functions and `lines( )`, of a data object, and those with a `utclong` result (`utclong_add( )` also with a calculated
  argument). `abs( ( i ) )` is left to #4749. It went upstream although it changes `compare.ts`: the logic is in a file
  of its own, `_initial_operand.ts`, and no open PR changes the same lines
  - [ ] follow-up once #3 is upstream: use `BuiltInCall.isDataObject` and `_parentheses.ts` there instead of its own
    copies

### Waiting PRs on the fork

Fixes that need the code of an open upstream PR (see "How a fix gets in"): open PRs on
[arcanist123/abaplint](https://github.com/arcanist123/abaplint/pulls), never merged there, all in the patch. Listed by
`gh pr list -R arcanist123/abaplint`; in order, each chain from the bottom up. Since 2026-11-27 (see "Two layers")
the ones below, which add checks for invalid code, are ported to layer 2 instead of going up; each is closed once its
port lands. New waiting PRs are only for layer 1 fixes.

Chain on `when.ts` and `compare.ts`, which starts going up once
[PR #4741](https://github.com/abaplint/abaplint/pull/4741) is merged:

| Order | PR | Branch | Base | Fixes |
|---|---|---|---|---|
| 1 | [abaplint#4761](https://github.com/abaplint/abaplint/pull/4761) (upstream, draft) | `case-when-arithmetic-4747` | upstream `main`, still with the #4741 commits | [#4747](https://github.com/abaplint/abaplint/issues/4747) |
| 2 | [arcanist123/abaplint#1](https://github.com/arcanist123/abaplint/pull/1) | `case-parentheses-4748` | `case-when-arithmetic-4747` | [#4748](https://github.com/abaplint/abaplint/issues/4748) |
| 3 | [arcanist123/abaplint#2](https://github.com/arcanist123/abaplint/pull/2) | `when-string-bit-table-4762` | `case-parentheses-4748` | [#4762](https://github.com/abaplint/abaplint/issues/4762) |
| 4 | [arcanist123/abaplint#3](https://github.com/arcanist123/abaplint/pull/3) | `comparison-argument-parentheses-4749` | `when-string-bit-table-4762` | [#4749](https://github.com/abaplint/abaplint/issues/4749), the rest after #4768 |
| 5 | [arcanist123/abaplint#4](https://github.com/arcanist123/abaplint/pull/4) | `string-operator-operands-4799` | `comparison-argument-parentheses-4749` | [#4799](https://github.com/abaplint/abaplint/issues/4799) |
| 6 | [arcanist123/abaplint#5](https://github.com/arcanist123/abaplint/pull/5) | `byte-operator-operands-4800` | `string-operator-operands-4799` | [#4800](https://github.com/abaplint/abaplint/issues/4800) |
| 7 | [arcanist123/abaplint#6](https://github.com/arcanist123/abaplint/pull/6) | `string-expression-numeric-function-4799` | `byte-operator-operands-4800` | [#4799](https://github.com/abaplint/abaplint/issues/4799), the rest after #4 |

#4761 was opened stacked before this rule, so it stays the upstream draft rather than move to the fork: once #4741 is
merged, rebase it onto `main` (which drops the #4741 commit) and mark it ready. Once #4761 is merged, #1 goes up as in
"When a waiting PR goes up", and each of #2 to #6 once the one before it is merged. #4768 only says "part of #4749", so
the upstream PR from #3 says `closes #4749`. For #4799 the upstream PR from #4 says "part of #4799" and the one from #6
`closes #4799`.

The fix for [#4801](https://github.com/abaplint/abaplint/issues/4801) changes `compare.ts` too, so by the rules above it
is a waiting PR on the end of this chain, based on `string-expression-numeric-function-4799`, unless its code can be
kept apart, as for #4802.

Closed 2026-11-28, since the compiler refuses their cases itself:
[arcanist123/abaplint#14](https://github.com/arcanist123/abaplint/pull/14) (`CONTINUE` outside a loop, a copy of
[PR #4653](https://github.com/abaplint/abaplint/pull/4653) by another author, on `retry-outside-catch-4723`) and
[arcanist123/abaplint#21](https://github.com/arcanist123/abaplint/pull/21) (static bounds of `n`, `d` and `t`, rebased
onto 2.120.123 first, branch `substring-bounds-ndt-4746`). Both branches stay on the fork.

### Syntax checks to move out of the compiler

The lowering had syntax checks of its own. Since 2026-11-27 they move to layer 2 (see "Two layers"), not out of
abap2go: each one goes to `src/check/`, and is removed only once an abaplint release reports the case in every
form. Since 2026-11-28 the lowering has none left. The list below records what abaplint reports and what it does
not. Compared on 2026-11-26 with 2.120.120 and the patch, the last six on 2026-11-28 with 2.120.123 and the patch.

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

Removed 2026-11-27, since abaplint reports them:
- in a class, `CASE` without any `WHEN`, or with statements before the first one
  ([#4744](https://github.com/abaplint/abaplint/issues/4744),
  [PR #4784](https://github.com/abaplint/abaplint/pull/4784), in 2.120.123). A macro call, an `INCLUDE` or an
  enhancement before the first `WHEN` is not reported, as it might supply the `WHEN`; the compiler supports none of
  these in a class
- a subfield of a type without subfields (`i+1(1)`), except of a `utclong` (below)
- static bounds outside a `c` or `x` field (`c+5`, `c+4(2)`); `n`, `d` and `t` are below
- a missing, unknown or repeated argument of `abs( )`, `sqrt( )`, `ipow( )` or `strlen( )`

Moved to layer 2 on 2026-11-28, since abaplint does not report them; each goes once a release does:
- [x] `CONTINUE` outside a loop, in every processing block (`src/check/loops.ts`): issue
  [#3660](https://github.com/abaplint/abaplint/issues/3660), with
  [PR #4653](https://github.com/abaplint/abaplint/pull/4653) of another author open (updated 2026-11-27). Its copy,
  waiting PR [arcanist123/abaplint#14](https://github.com/arcanist123/abaplint/pull/14), is closed (2026-11-28)
- [x] [#4743](https://github.com/abaplint/abaplint/issues/4743) a number literal of more than 31 digits
  (`src/check/literals.ts`), also in a `VALUE` addition, which `Constant.runSyntax` does not see. Leading zeros are
  expected to count and the sign not; the lowering used to strip leading zeros before counting
- [x] [#4746](https://github.com/abaplint/abaplint/issues/4746) static bounds outside a flat field of type `n`, `d`
  or `t`, `d+8`, `n(6)` (`src/check/substring.ts`), by the rules abaplint applies to `c` and `x`: with a variable
  offset or length the other one is not checked against the field. Unlike abaplint for `c` and `x`, a constant as
  offset or length counts as static, as it is expected to, and a component of a structure is checked. Field symbols
  and generic `n` parameters are not checked. Waiting PR
  [arcanist123/abaplint#21](https://github.com/arcanist123/abaplint/pull/21) is closed (2026-11-28)

Removed 2026-11-28, since 2.120.123 reports every form the lowering checked; their tests expect abaplint's finding:
- [x] [#4729](https://github.com/abaplint/abaplint/issues/4729) `utclong` in an arithmetic expression, `u + 1`.
  Fixed in [PR #4828](https://github.com/abaplint/abaplint/pull/4828), in 2.120.123: arithmetic expressions and
  signs, `+=`, `-=`, `*=` and `/=` (also after `NEXT`), `ADD`, `SUBTRACT`, `MULTIPLY`, `DIVIDE`, `nmax( )` and
  `nmin( )`, in assignments, conditions, `CASE`, `DO … TIMES`, `CONV`, templates and inline declarations. The
  comparison `u = i + 1` is reported by [PR #4741](https://github.com/abaplint/abaplint/pull/4741). A dictionary
  type `UTCL` is covered since [PR #4832](https://github.com/abaplint/abaplint/pull/4832). Not covered: an operand
  after a constructor expression (see "Backlog"), and `COMPUTE` (below). #4828 only says "part of #4729": close the
  issue once #4741 is merged too
- [x] [#4730](https://github.com/abaplint/abaplint/issues/4730) a subfield of length 0 of a flat field, `c+1(0)`.
  Fixed in [PR #4829](https://github.com/abaplint/abaplint/pull/4829), in 2.120.123: a literal length of 0 on a `c`,
  `n`, `d`, `t` or `x` field, a structure, and the generic types `c`, `n`, `x`, `clike`, `csequence`, `xsequence`
  and `simple`. A `string`, an `xstring`, `any` and `data` stay valid, and so are two positions: the source of
  `ASSIGN` (`ASSIGN c+1(0) TO <fs>.`) and the target of `WRITE … TO`. Not covered: a constant of value 0 as the
  length (arcanist123/abaplint#18, see "Later")
- [x] [#4745](https://github.com/abaplint/abaplint/issues/4745) a subfield of a `utclong`, `s = u+1(1)`, `u(1) = s`.
  Fixed in [PR #4828](https://github.com/abaplint/abaplint/pull/4828), in 2.120.123, also for a field symbol of
  type `utclong` and a dictionary type `UTCL`. The offset `0` and the length `*` take the whole field and stay
  valid (`u+0`, `u(*)`, `u+0(*)`); the lowering, which refused them as syntax errors, now refuses the length `*` as
  not compiled yet

Open, layer 1: abaplint parses `COMPUTE` into the right tree (a `Compute` statement with its `Target` and `Source`),
but its syntax check has no handler for the statement and skips it. Nothing in it is resolved or typed: valid code
such as `COMPUTE r = i + 1.` gets no references and no types, where `r = i + 1.` gets a write to `r` and a read of
`i`. As a consequence, `COMPUTE r = zzz + 1.` with an unknown `zzz`, `COMPUTE r = u + 1.` with a `utclong` and
`COMPUTE s = c5(0).` are accepted, while ABAP is expected to reject each of them. Valid code left untyped is a layer 1
defect, so the fix goes upstream: a handler that checks `COMPUTE` (with or without `EXACT`) as the assignment it
stands for, in [PR #4844](https://github.com/abaplint/abaplint/pull/4844) (merged 2026-11-28, not released yet).
No layer 2 check is written for it, since layer 2 cannot type a statement on its own. The compiler does not compile
`COMPUTE` yet and refuses it as not supported; it needs the fix before it does.

Dropped 2026-11-27, since it is no syntax error: a `utclong` value after `WHEN` when the operand of `CASE` is an
arithmetic expression, `CASE i + 1. WHEN u.`, is expected to be valid, unlike `CASE i. WHEN u.`, so abaplint is right
to accept it. The refusal in `src/lower_cond.ts` is a form the compiler does not compile yet, not a syntax check.

## Later: with the compiler step that needs it

The compiler steps are in [compiler_roadmap.md](compiler_roadmap.md), "Next". When a step starts, its valid ABAP comes
first.

Valid ABAP that abaplint mistypes, fails to parse or rejects:

| Issue | What | Pick up with |
|---|---|---|
| [arcanist123/abaplint#22](https://github.com/arcanist123/abaplint/issues/22) | an inline declaration from a calculation with a `c`, `n` or `string` operand (`DATA(x) = i * '2'.`, `i + n`, `i8 + '1'`, `+ n`) is typed `i`, `int8` or `n`. The text operand makes the calculation type `p`, so `p LENGTH 8 DECIMALS 0` is expected ([spec/calculation.md](spec/calculation.md), "Inline declarations"); found 2026-11-28 through open-steamgate's `ANOMALY-2026-09-17-character-operand-calculation-type`. How to fix it is not decided yet | inline declarations (compiler step 5) |
| [#4756](https://github.com/abaplint/abaplint/issues/4756) | a literal passed to a parameter of the generic type `p` is reported as not compatible: valid code rejected | method calls with parameters |
| [#4754](https://github.com/abaplint/abaplint/issues/4754) | `NEW lcl( )->attr = 1.` gives "Not an object reference, target" for any attribute | objects and `NEW` |
| [#4779](https://github.com/abaplint/abaplint/issues/4779) | `NEW` with `LET`, `FOR`, `BASE`, `LINES OF` or default components in front of table rows does not parse | objects and `NEW` |
| [#4687](https://github.com/abaplint/abaplint/issues/4687) | `CORRESPONDING`: `APPENDING`, `EXACT`, lookup table and `MAPPING ... DEFAULT` not parsed (nested `MAPPING` is merged, [PR #4688](https://github.com/abaplint/abaplint/pull/4688)) | structures and `CORRESPONDING` |
| [#4755](https://github.com/abaplint/abaplint/issues/4755) | `INSERT itab.`, the short form for a table with a header line, parses as InsertDatabase (context-free parser). Putting it in the InsertInternal grammar is a design question for the abaplint maintainer | tables with a header line, if they are compiled |

Invalid ABAP that abaplint accepts:

| Issue | What | Pick up with |
|---|---|---|
| [#4801](https://github.com/abaplint/abaplint/issues/4801) | `IN` with a right operand that is not a ranges table (`i IN c`, another line type, `( r )`, `VALUE #( )`), and an arithmetic expression before a table with a character-like `low`, are accepted | predicates and operators, `IN` once ranges tables are compiled |
| [#4806](https://github.com/abaplint/abaplint/issues/4806) | non-character operands of `CO` to `NP` in a `WHERE` condition of an internal table (`LOOP AT`, `DELETE`, `MODIFY`, `FOR`) are accepted: `ComponentCompare` checks no operand types. A numeric built-in function on the right is expected to be an error there too. The byte operators are not checked there either, their expected behaviour is not worked out | predicates and operators |
| [#4712](https://github.com/abaplint/abaplint/issues/4712) | the literal of a `VALUE` addition that does not convert to a numeric type (`DATA i TYPE i VALUE 'abc'.`, a number outside the range) is accepted. A move of such a literal (`i = 'abc'.`) is expected to give only a warning: valid code, the conversion fails at run time | now, in layer 2: the compiler compiles `DATA … VALUE` and builds such a literal, which fails at run time (see [compiler_roadmap.md](compiler_roadmap.md), "Next") |
| [#4642](https://github.com/abaplint/abaplint/issues/4642) | an assignment between flat structures with non-matching fragment views is accepted | structure assignments |
| [#4772](https://github.com/abaplint/abaplint/issues/4772) | parentheses around an actual parameter of a method are accepted when the formal parameter is character-like, a date, a table or of type `data`; with a numeric parameter they are valid | method calls with parameters |
| [#4775](https://github.com/abaplint/abaplint/issues/4775) | parentheses around a single operand in `NEW`. A check has to cover the forms of [#4779](https://github.com/abaplint/abaplint/issues/4779) too once they parse | objects and `NEW` |
| [#4776](https://github.com/abaplint/abaplint/issues/4776) | parentheses around the work area of `MODIFY`, `COLLECT`, `READ TABLE` and `DELETE TABLE`, and a calculation there for the last three | internal tables |
| [#4780](https://github.com/abaplint/abaplint/issues/4780) | a built-in function as the work area of `COLLECT`, `READ TABLE` and `DELETE TABLE` | internal tables |
| [#4777](https://github.com/abaplint/abaplint/issues/4777) | parentheses around a single operand as the whole source of an inline declaration | inline declarations |
| [#4778](https://github.com/abaplint/abaplint/issues/4778) | parentheses around a string expression or a string template | `&&` and string templates |
| [arcanist123/abaplint#7](https://github.com/arcanist123/abaplint/issues/7) | in a comparison with a string expression, a string template or a string function, parentheses around a single operand on either side (`s && s = ( c )`, `( c ) CO s && s`, also around a method call or a constructor expression) are accepted. Next to a field, a method call or a bit expression they are expected to be fine | `&&` and string templates |
| [arcanist123/abaplint#8](https://github.com/arcanist123/abaplint/issues/8) | a numeric built-in function compared with such a string expression or with a bit expression (`s && s = strlen( s )`, either side, also in `BETWEEN`) is accepted; with a bit expression `=`, `<>` and `<` are already reported. Against a field and after `WHEN` the function is expected to be valid | `&&` and string templates |
| [arcanist123/abaplint#9](https://github.com/arcanist123/abaplint/issues/9) | a numeric built-in function (`s = s && strlen( s )`, `s &&= strlen( s )`) or an arithmetic or bit expression (`s && i + 1`) as an operand of `&&` is accepted. A numeric field, literal or method call there is expected to be valid | `&&` and string templates |
| [arcanist123/abaplint#10](https://github.com/arcanist123/abaplint/issues/10) | `find( )`, `count( )`, `distance( )`, `line_index( )`, and a length or numeric function of something other than a data object (`c = strlen( s && s )`), compared with a non-numeric operand, are accepted, also with [PR #4741](https://github.com/abaplint/abaplint/pull/4741). Against a numeric operand they are expected to be valid | string functions and functional method calls |
| [arcanist123/abaplint#11](https://github.com/arcanist123/abaplint/issues/11) | an operand after `WHEN` in `SWITCH` that is not constant (a variable, a method call, a function, a calculation) is accepted | `SWITCH` |
| [arcanist123/abaplint#12](https://github.com/arcanist123/abaplint/issues/12) | a bit expression compared with an operand that is not byte-like (`x BIT-AND x = c`) is accepted; with a numeric operand `=`, `<>` and `<` are already reported next to `BIT-AND` | bit expressions |
| [arcanist123/abaplint#13](https://github.com/arcanist123/abaplint/issues/13) | a bit expression used as a number (`i = BIT-NOT x.`, as the argument of a numeric function, as a numeric actual parameter) is accepted. `c` and `string` targets are expected to be valid | bit expressions |
| [#4785](https://github.com/abaplint/abaplint/issues/4785) | in a class, `CASE TYPE OF` without any `WHEN`, or with `DATA` before the first one, is accepted; outside classes only a warning is expected. It builds on the check of [PR #4784](https://github.com/abaplint/abaplint/pull/4784), in 2.120.123 | objects and `CASE TYPE OF` |
| [arcanist123/abaplint#18](https://github.com/arcanist123/abaplint/issues/18) | a constant as offset or length is not checked against the field: beyond it (`c+lc_off`, `c(lc_len)`) and a length of value 0 are accepted, also after [PR #4829](https://github.com/abaplint/abaplint/pull/4829). With a variable offset a constant length beyond the field is expected to be valid. [PR #4759](https://github.com/abaplint/abaplint/pull/4759) also accepts `c+5(ref->lc_len)`, a constant behind `->`, as if it were a variable, which the issue does not cover. The test "ok, offset given by a constant" expects no error | `CONSTANTS`, before a constant is an offset or length |
| [arcanist123/abaplint#19](https://github.com/arcanist123/abaplint/issues/19) | an offset or length on the source of `ASSIGN` to an inline declared field symbol (`ASSIGN c+1(2) TO FIELD-SYMBOL(<fs>).`) is accepted. With a declared field symbol it is expected to be valid | field symbols and `ASSIGN` |
| [arcanist123/abaplint#20](https://github.com/arcanist123/abaplint/issues/20) | `ASSIGN` of a data object with an offset but without a length (`ASSIGN c+2 TO <fs>.`) is accepted. With a length or `*`, and with a source which starts with a field symbol (`<c>+2`), it is expected to be valid | field symbols and `ASSIGN` |

arcanist123/abaplint#18 to #20 change code which [PR #4829](https://github.com/abaplint/abaplint/pull/4829) and
[PR #4830](https://github.com/abaplint/abaplint/pull/4830) changed (`_substring.ts`, `assign.ts`), both in 2.120.123,
so their fixes build on upstream `main`.

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

PRs that the pinned release, 2.120.123, does not contain, as of 2026-11-28. The patch also holds waiting PRs
arcanist123/abaplint#1 to #6, which are not in this table (see "Waiting PRs on the fork").

The checks among them move to layer 2 (see "Two layers"), each leaving the patch once its port lands. #4684 leaves
as well, since abap2go refuses `EXEC SQL` and does not compile AMDP. That leaves #4631 as the patch's only PR, a
layer 1 fix the compiler needs for `b` and `s`; the patch stays for it until a release has it.

| PR | What | State |
|---|---|---|
| [#4631](https://github.com/abaplint/abaplint/pull/4631) | INT1 and INT2 keep their size ([#4630](https://github.com/abaplint/abaplint/issues/4630)); the compiler declares `b` and `s` through data elements | open |
| [#4633](https://github.com/abaplint/abaplint/pull/4633) | `METHODS` see only the types defined above them ([#2556](https://github.com/abaplint/abaplint/issues/2556)) | draft, changes requested, parked (see "Parked") |
| [#4635](https://github.com/abaplint/abaplint/pull/4635) | a write to a `READ-ONLY` attribute from outside the class ([#2097](https://github.com/abaplint/abaplint/issues/2097)). It also covers [#2611](https://github.com/abaplint/abaplint/issues/2611): add `closes #2611` to the PR, or comment on #2611 after the merge | open |
| [#4684](https://github.com/abaplint/abaplint/pull/4684) | `\|` and `}` in EXEC SQL or an AMDP body taken as a string template, valid code mis-lexed ([#4329](https://github.com/abaplint/abaplint/issues/4329)) | open |
| [#4739](https://github.com/abaplint/abaplint/pull/4739) | `RETRY` outside a `CATCH` block is an error ([#4723](https://github.com/abaplint/abaplint/issues/4723)) | open |
| [#4741](https://github.com/abaplint/abaplint/pull/4741) | comparisons without a comparison type, also after `WHEN`, and calculations compared with non-numeric operands are errors ([#4728](https://github.com/abaplint/abaplint/issues/4728), [#4738](https://github.com/abaplint/abaplint/issues/4738)) | open |
| [#4761](https://github.com/abaplint/abaplint/pull/4761) | an arithmetic expression or a calculating built-in function after `WHEN` is an error ([#4747](https://github.com/abaplint/abaplint/issues/4747)) | draft, waits for #4741 |

Released and out of the patch:
- in 2.120.123: [PR #4784](https://github.com/abaplint/abaplint/pull/4784) (in a class, `CASE` without `WHEN`,
  [#4744](https://github.com/abaplint/abaplint/issues/4744)), [PR #4811](https://github.com/abaplint/abaplint/pull/4811)
  (a calculation before `IS [NOT] INITIAL`, [#4802](https://github.com/abaplint/abaplint/issues/4802)),
  [PR #4828](https://github.com/abaplint/abaplint/pull/4828) (a `utclong` in a calculation or with an offset or length,
  [#4745](https://github.com/abaplint/abaplint/issues/4745), part of
  [#4729](https://github.com/abaplint/abaplint/issues/4729)), [PR #4829](https://github.com/abaplint/abaplint/pull/4829)
  (a substring length of 0, [#4730](https://github.com/abaplint/abaplint/issues/4730)),
  [PR #4830](https://github.com/abaplint/abaplint/pull/4830) (an offset or length taking a whole numeric field,
  arcanist123/abaplint#15), [PR #4832](https://github.com/abaplint/abaplint/pull/4832) (a dictionary type of data type
  `UTCL` is a `utclong`, arcanist123/abaplint#16), [PR #4836](https://github.com/abaplint/abaplint/pull/4836) (the
  character-like initial part of a flat structure)
- in 2.120.122: [PR #4766](https://github.com/abaplint/abaplint/pull/4766) (`bit-set( )` and `boolx( )` parse,
  [#4764](https://github.com/abaplint/abaplint/issues/4764)), [PR #4767](https://github.com/abaplint/abaplint/pull/4767)
  (a named argument of `abs( )`, [#4750](https://github.com/abaplint/abaplint/issues/4750)),
  [PR #4768](https://github.com/abaplint/abaplint/pull/4768) (parentheses in built-in arguments, part of
  [#4749](https://github.com/abaplint/abaplint/issues/4749)), [PR #4773](https://github.com/abaplint/abaplint/pull/4773)
  (`sep` of `from_mixed( )`, [#4769](https://github.com/abaplint/abaplint/issues/4769)),
  [PR #4774](https://github.com/abaplint/abaplint/pull/4774) (parentheses around operands,
  [#4771](https://github.com/abaplint/abaplint/issues/4771))
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
  [PR #4773](https://github.com/abaplint/abaplint/pull/4773), in 2.120.122
- [x] [#4764](https://github.com/abaplint/abaplint/issues/4764) `bit-set( 1 )` and `boolx( bool = i = 1 )` do not
  parse: `bit-set` is lexed as `bit`, `-`, `set`, and the logical expression of `boolx( )` is not handled the way
  `boolc( )` and `xsdbool( )` are in `Source`. Found 2026-11-26 while fixing #4762; valid code that fails to parse.
  Fixed by [PR #4766](https://github.com/abaplint/abaplint/pull/4766), in 2.120.122: both are their own forms in
  `Source`, typed `xstring`. `boolx( bool = abap_true )`, no logical expression, still parses as a method call
- [ ] [arcanist123/abaplint#15](https://github.com/arcanist123/abaplint/issues/15) an access which takes a whole
  numeric field, with the offset `0`, the length `*` or the field's length in bytes (`i+0`, `i(*)`, `i+0(4)`, `f(8)`,
  `p+0(5)`), is reported as a substring the type does not permit, while ABAP is expected to accept it; only `p(5)` is
  accepted. Found 2026-11-27 while fixing #4745. Fixed in [PR #4830](https://github.com/abaplint/abaplint/pull/4830),
  open, not in the patch yet (see "In the patch"). On the generic type `decfloat` only the offset `0` and the length `*`
  are accepted. Not covered: a constant as the offset or length; close the issue once the PR is merged
  - [ ] follow-up once [PR #4631](https://github.com/abaplint/abaplint/pull/4631) is merged: take the byte length of an
    integer from `IntegerType.getBytes()`. Until then a dictionary field of type `INT1` or `INT2` accepts the length 4
    and reports its own length, 1 or 2

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
- [x] [arcanist123/abaplint#16](https://github.com/arcanist123/abaplint/issues/16) a dictionary type of data type
  `UTCL` was read as `c LENGTH 27` (`ddic.ts`) instead of `utclong`. Fixed by
  [PR #4832](https://github.com/abaplint/abaplint/pull/4832), in 2.120.123
- [ ] [arcanist123/abaplint#17](https://github.com/arcanist123/abaplint/issues/17) in a calculation, the operand after
  a constructor expression (`CONV`, `COND`, `SWITCH`, `VALUE`, `EXACT`, `REDUCE`) is not checked as an operand of it: a
  reference or a `utclong` there is accepted, and after `SWITCH`, `VALUE` and `EXACT` an unknown field too. The type is
  wrong for valid code (`DATA(x) = CONV i( 1 ) + p.` gives `i`, expected `p`), which the compiler takes over. Found
  2026-11-27 while fixing #4729

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
Since 2026-11-27 (see "Two layers") abap2go simply turns these rules on next to check_syntax in
`src/validation.ts`, as it does for the first three; whether they move into check_syntax is the maintainer's choice.
- [ ] turn on method_implemented_twice, superclass_final, identical_form_names and check_include in
  `src/validation.ts`
- [ ] optional, only if [#4690](https://github.com/abaplint/abaplint/issues/4690) is answered with a yes: start with
  one small, clear case as a PR. Suggested first: identical_form_names or superclass_final (small, self-contained)
- note: our own PRs [#4633](https://github.com/abaplint/abaplint/pull/4633) (open, parked) and
  [#4636](https://github.com/abaplint/abaplint/pull/4636) (merged) report through unknown_types; once the approach is
  agreed, they move too

### Non-Unicode-only syntax

Found 2026-11-22. abaplint has no notion of non-Unicode programs: no config setting, the UCCHECK flag of the program
is not read. The grammar accepts old and modern forms together, while the syntax check assumes Unicode (e.g. byte
lengths in `_check_database_work_area.ts`). In modern ABAP every program is Unicode, so non-Unicode-only forms are
expected to be syntax errors; abaplint accepts several of them, for every `syntax.version`. Following ABAP, this
belongs in the parser / check_syntax, not in a rule option.

Asked 2026-11-26 in
[a comment on #4753](https://github.com/abaplint/abaplint/issues/4753#issuecomment-7196231659): either non-Unicode-only
forms are errors everywhere, or the Unicode flag of the program (UCCHECK) or a config setting decides, with Unicode as
the default.

**Since 2026-11-27 this is layer 2** (see "Two layers"). abaplint accepts some of these forms on purpose:
`OPEN DATASET f.` with no addition parses since [PR #3571](https://github.com/abaplint/abaplint/pull/3571).
Non-Unicode programs are out of scope for abap2go. It reads the UCCHECK flag of each program itself: its scope pass refuses a
program without the flag, and its layer 2 checks reject the non-Unicode-only forms in the others. #4753 no longer
blocks anything. The inventory below becomes the list of those checks. The forms found so far are a missing addition, visible
in the tree, or a rule on types, so the checks do not depend on how abaplint resolves ambiguous parses
([abaplint_ambiguous_parsing.md](abaplint_ambiguous_parsing.md), "Unicode flag").

- [ ] [#4753](https://github.com/abaplint/abaplint/issues/4753) `OPEN DATASET f.` without `FOR ...` or
  `IN ... MODE`; with no addition at all it parses since
  [66bfba641](https://github.com/abaplint/abaplint/commit/66bfba641)
  ([PR #3571](https://github.com/abaplint/abaplint/pull/3571)), which adds a test for it
- [ ] also accepted, named in the comment: `DESCRIBE FIELD ... LENGTH` and `DESCRIBE DISTANCE` without
  `IN ... MODE`, and an offset/length that reaches past the character-like start of a structure. Already errors:
  `CONCATENATE` of byte-like fields without `IN BYTE MODE`, and `TRANSLATE ... CODE PAGE` (does not parse)
- [ ] rest of the inventory: work out the expected behaviour of the other non-Unicode-only forms, compare with
  abaplint
