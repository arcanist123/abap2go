# Special values: infinities and NaN

Part of the rule-table specification ([compiler_roadmap.md](../compiler_roadmap.md), critical path): what ABAP does
with an `f` holding `+Inf`, `-Inf` or NaN and with a `decfloat16` or `decfloat34` holding an infinity or a NaN. It
adds to [conversion.md](conversion.md), [calculation.md](calculation.md) and [comparison.md](comparison.md), whose
rules apply wherever nothing else is said here. The keyword documentation says little about these values (a decimal
floating point special value is not a valid number for a conversion into another kind of type, and `EXACT` rejects
it); the rest is worked out cell by cell.

**Status (2026-11-27): specified, not implemented.** The runtime does not store these values yet: where a `TRY`
could read one, the program ends with `SPECIAL_VALUE_NOT_SUPPORTED` (see "Implementation" below). The test cases are
not run by the tests yet:

| File in `runtime/go/abap/testdata/` | Cells | Content |
|---|---|---|
| [`special_conversion.tsv`](../../runtime/go/abap/testdata/special_conversion.tsv) | 312 | moves into every kind of type |
| [`special_calculation.tsv`](../../runtime/go/abap/testdata/special_calculation.tsv) | 3,040 | operators, functions, assignment operators, result fields, `CONV`, `EXACT` |
| [`special_comparison.tsv`](../../runtime/go/abap/testdata/special_comparison.tsv) | 841 | comparisons of two data objects known at run time |
| [`special_comparison_expr.tsv`](../../runtime/go/abap/testdata/special_comparison_expr.tsv) | 3,899 | static operands, arithmetic operands, `CASE`, `DO`, subfields |
| [`special_template.tsv`](../../runtime/go/abap/testdata/special_template.tsv) | 315 | string templates with their format options |

## Notation

| Written | `f` bits | How a program gets it |
|---|---|---|
| `@+Inf` | `7FF0000000000000` | `f`: the text `1E400` moved into it, `CX_SY_CONVERSION_OVERFLOW` caught. `decfloat16`: the same with a `decfloat34` holding `1E400`. `decfloat34`: moved from an `f` or `decfloat16` holding `+Inf` |
| `@-Inf` | `FFF0000000000000` | as `@+Inf`, with `-1E400` |
| `@NaN` | `7FF8000000000000` | `f`: the text `NAN` moved into it, `CX_SY_CONVERSION_OVERFLOW` caught. Decimal floating point: moved from such an `f` |
| `@-NaN` | `FFF8000000000000` | `f`: `+Inf - +Inf`. Decimal floating point: `- a` with `a` holding `@NaN` |

A decimal floating point target holding one of them reads `+Infinity`, `-Infinity`, `NaN` or `-NaN`.

## Where they come from

The first special value of a program is expected to come from a **caught** `CX_SY_CONVERSION_OVERFLOW`, one of those
listed in [conversion.md](conversion.md), "The target after an exception":

- text that overflows an `f` (`1E400`, `-INF`, `NAN`), also from an `n`;
- a `decfloat16` or `decfloat34` beyond the range of `f`;
- a `decfloat34` beyond the range of `decfloat16`, also as the result of a calculation moved into a `decfloat16`
  result field, and likewise a calculation result moved into an `f` result field.

Text that overflows a decimal floating point type keeps the target. No operator or function with finite operands is
expected to leave a special value: it raises its exception and keeps the result field.

Once there is one, it spreads **without** exceptions: an `f` special value moves into a decimal floating point field,
and some operations store special results (below).

## Conversions

| Source | Target | Result |
|---|---|---|
| `f` | `f` | copied, the NaN with its sign |
| `f` | `decfloat16`, `decfloat34` | carried over: `+Infinity`, `-Infinity`, `NaN`, `-NaN`, no exception |
| `f` ±Inf | `i`, `int8`, `p`, `c`, `n`, `string`, `d`, `t`, `x`, `xstring` | `CX_SY_CONVERSION_OVERFLOW`, target kept |
| `f` ±Inf | `b`, `s` | `CX_SY_CONVERSION_OVERFLOW`, target left `0` |
| `f` NaN | `i`, `int8` | **no exception**: the smallest value, `-2147483648` or `-9223372036854775808` |
| `f` NaN | `b`, `s` | no exception: `0` |
| `f` NaN | `p`, `c`, `n`, `string`, `d`, `t`, `x`, `xstring` | `CX_SY_CONVERSION_OVERFLOW`, target kept |
| decimal floating point | `decfloat16`, `decfloat34` | carried over |
| decimal floating point | every other type, `f` among them | `CX_SY_CONVERSION_NO_NUMBER`, target kept |

`EXACT type( a )` keeps the target in every case: from an `f` it raises `CX_SY_CONVERSION_NO_NUMBER` into a decimal
floating point type and `CX_SY_CONVERSION_OVERFLOW` into any other, also for a NaN into `i`, `int8`, `b` and `s`;
from a decimal floating point number it raises `CX_SY_CONVERSION_NO_NUMBER` into every other type, the other decimal
floating point type included.

## Arithmetic

The calculation type is that of [calculation.md](calculation.md), so an `f` special value is calculated in `f` or,
with a decimal floating point operand or result field, carried into `decfloat34`. A decimal floating point special
value is always calculated in `decfloat34`. An exception keeps the result field. A result that is stored goes into
the result field by *Conversions*: an `f` NaN into an `i` result field leaves the smallest `i` without an exception,
and a `decfloat34` special value into an `f` result field raises `CX_SY_CONVERSION_NO_NUMBER`.

An assignment operator and `ADD`, `SUBTRACT`, `MULTIPLY`, `DIVIDE` are the operator on the result field: with
`+Inf` in an `f` field, `r += 1` and `r /= 2` raise and `r *= 0` stores `-NaN`.

### Calculation type f

`+ - * / DIV MOD`, in this order:

1. a zero dividend of `/`, `DIV` or `MOD` gives `+0`, whatever the divisor, a NaN included;
2. a zero divisor otherwise raises `CX_SY_ZERODIVIDE`, also for an infinite or NaN dividend;
3. the operation follows IEEE 754; `DIV` is the Euclidean quotient `q` and `MOD` is `a - b * q`;
4. an infinite result of `+ - * /` or `DIV` raises `CX_SY_ARITHMETIC_OVERFLOW`;
5. a NaN result is **stored** without an exception. So `Inf - Inf`, `0 * Inf` and `Inf / Inf` store a NaN, and
   `a MOD b` with an infinite operand gives a NaN (`1 MOD +Inf` is `-NaN`). `a / ±Inf` and `a DIV ±Inf` with a finite
   `a` give a signed zero (`-1 DIV +Inf` is `-0`).

**The sign of a NaN.** An operation with a NaN operand gives that NaN, with its sign; with two NaN operands the left
one. A NaN that an operation makes from other operands is `-NaN`. The sign shows once the value is moved into a
decimal floating point field.

**`**`** is expected to follow C's `pow( )`, and an infinite result is stored without an exception (`+Inf ** 1`,
`2 ** +Inf`, `0 ** -Inf`). A finite negative base with a finite non-integer exponent raises
`CX_SY_ARG_OUT_OF_DOMAIN` as before, `-Inf ** 0.5` is `+Inf`. `a ** 0` and `1 ** b` are 1 even for a NaN; `NaN ** 1`
is expected to be the positive `NaN` for either sign.

### Calculation type decfloat34

- A zero dividend of `/`, `DIV` or `MOD` gives zero, whatever the divisor.
- **There is no `CX_SY_ZERODIVIDE` for a special dividend:** an infinity divided by zero (`/`, `DIV`) is an infinity,
  a NaN divided by zero is a NaN.
- An invalid operation **raises** `CX_SY_ARITHMETIC_OVERFLOW` instead of making a NaN: `+Inf - +Inf`,
  `+Inf + -Inf`, `0 * Inf`, `Inf / Inf`, `Inf DIV Inf`, and `MOD` with one infinite operand and no NaN.
- `MOD` with **both** operands infinite is expected to end with the runtime error `RUNT_INTERNAL_ERROR`, which cannot
  be caught.
- Any other infinite result is stored without an exception (`Inf + 1`, `Inf * -2`, `Inf / 0`).
- A finite number divided by an infinity is a signed zero (`1 / +Inf` is `0E-6176`, `-1 DIV +Inf` is `-0`).
- A NaN operand gives a NaN without an exception, with the sign of the left NaN operand.

**`**`**, which raises no overflow:

| Operands | Result |
|---|---|
| either is a NaN | NaN, also for `1 ** NaN`, `0 ** NaN` and `NaN ** 0` |
| `±Inf ** 0` | 1 |
| `+Inf ** y` | `+Inf` for `y > 0` and `+Inf`, 0 for `y < 0` and `-Inf` |
| `-Inf ** y`, `y` a finite integer | for `y > 0` an infinity with the sign of the power (`-Inf ** 3` is `-Inf`), for `y < 0` a zero (`-Inf ** -1` is `-0`) |
| `-Inf ** y`, `y` infinite or not an integer | `CX_SY_ARG_OUT_OF_DOMAIN` |
| `a ** ±Inf`, `a` negative | `CX_SY_ARG_OUT_OF_DOMAIN` |
| `0 ** ±Inf` | 0 for `+Inf`, `CX_SY_ARG_OUT_OF_DOMAIN` for `-Inf` |
| `a ** ±Inf`, `a` positive | 1 for `a = 1` (with 34 digits), else `+Inf` or 0 as the limit |

### Signs and functions

| Expression | `f`: `+Inf` | `f`: `-Inf` | `f`: NaN | decfloat: `+Inf` | decfloat: `-Inf` | decfloat: NaN |
|---|---|---|---|---|---|---|
| `+ a` | `+Inf` | `-Inf` | same NaN | `+Inf` | `-Inf` | same NaN |
| `- a` | `-Inf` | `+Inf` | same NaN | `-Inf` | `+Inf` | sign changed |
| `abs( a )` | `+Inf` | `+Inf` | `NaN` | `+Inf` | `+Inf` | `NaN` |
| `sign( a )` | 1 | -1 | 0 | 1 | -1 | 1, for `-NaN` -1 |
| `sqrt( a )` | `+Inf` | domain | same NaN | `+Inf` | domain | same NaN |
| `exp( a )` | `+Inf` | 0 | same NaN | `+Inf` | 0 | same NaN |
| `log( a )`, `log10( a )` | `+Inf` | domain | same NaN | `+Inf` | domain | same NaN |
| `ceil`, `floor`, `trunc` | `a` | `a` | same NaN | `a` | `a` | same NaN |
| `frac( a )` | 0 | -0 | same NaN | `NaN` | `NaN` | same NaN |
| `nmax( val1 = a val2 = 1 )` | `+Inf` | 1 | `a` | `+Inf` | 1 | 1 |
| `nmax( val1 = 1 val2 = a )` | `+Inf` | 1 | 1 | `+Inf` | 1 | `a` |
| `nmin( val1 = a val2 = 1 )` | 1 | `-Inf` | `a` | 1 | `-Inf` | 1 |
| `nmin( val1 = 1 val2 = a )` | 1 | `-Inf` | 1 | 1 | `-Inf` | `a` |

"domain" is `CX_SY_ARG_OUT_OF_DOMAIN`. None of these raises an overflow: in `f`, `- a` of an infinity stores an
infinity, although `0 - a` raises.

**`ipow( )`** with a special base: exponent 0 gives 1; otherwise a NaN stays the NaN, an `f` infinity raises
`CX_SY_ARITHMETIC_OVERFLOW`, and a decimal floating point infinity gives an infinity with the sign of the power for a
positive exponent and a signed zero for a negative one.

**A special exponent of `ipow( )`:**

- decimal floating point: counts as 0, the result is 1;
- `f`, base 2: `CX_SY_ARITHMETIC_OVERFLOW`;
- `f` `+Inf`, base 1, calculated in `f`: the statement is expected not to finish in any practical time (`NOEND` in the test
  cases).

### Constructors and declarations

`DATA(r) = a + 1`, `CONV` and `EXACT` calculate as above and then move or declare by their usual rules: an `f`
infinity raises in the calculation (`a + 0`), an `f` NaN passes and is converted by *Conversions*, and a decimal
floating point special value reaches a decimal floating point result. `EXACT` raises
`CX_SY_CONVERSION_NO_NUMBER` when the `decfloat34` result goes into any other type, `decfloat16` included.

## Comparisons

The comparison type is that of [comparison.md](comparison.md), and so are the conversions of the other operand: text
that is not a number there ends the program. In the comparison type `f` the texts `Infinity`, `NAN` and `1E400` end it
with `CONVT_OVERFLOW`; in `decfloat34`, `Infinity` and `NAN` end it with `CONVT_NO_NUMBER`, while `1E400` is a
number.

**Infinities** are ordered as expected: `+Inf` is greater than every finite value and equal to `+Inf`, `-Inf` the
other way round.

**NaN** is not ordered consistently, and the outcome depends on more than the two values:

| Operands | Comparison type `f` | Comparison type `decfloat34` |
|---|---|---|
| two statically typed `f` data objects | `a` is **greater** than `b`, whichever of them is the NaN | - |
| other data objects: a generic operand, or one that is converted | `a` is **less** than `b` | `a` is **equal** to `b` |
| an arithmetic expression on either side | `a` is **less** than `b` | by the sign of the NaN, see below |

- "`a` is greater than `b`" means that `>`, `>=` and `<>` are true and `<`, `<=` and `=` false, **also with the sides
  swapped**: with a NaN, `a > b` and `b > a` are both true. This holds for two NaNs and for a data object compared
  with itself (`a = a` is false in `f`).
- "Equal" for two data objects in `decfloat34` means that a NaN equals every value, the infinities included.
- **An arithmetic expression in `decfloat34`:** with one NaN, `a` compares as greater than `b` if the NaN is
  positive and as less if it is negative, on whichever side the NaN stands. Two NaNs of the same sign are equal;
  otherwise `NaN` is greater than `-NaN`. So `a + 0 = 0` is false for a NaN `a`, while `a = 0` is true.
- Statically typed `f` data objects include structure components, table lines, dereferenced typed references and
  `CONV f( )`. An `f` field symbol or parameter of type `any` is generic. A built-in function of a single data object
  (`abs( a )`) counts as a data object that is not a static `f`: `abs( a ) < b` is true for a NaN.
- An infinite `f` operand of an arithmetic expression raises the exception of the calculation (`a + 0 = 0`), while
  `- a = 0` is compared.

`BETWEEN` is its two comparisons. `IS INITIAL` is false for every special value.

**`CASE`** compares by `operand = value` as for data objects, also for a calculated operand: a decimal floating point
NaN matches every `WHEN` value, and an `f` NaN matches no `f` or integer value.

## String templates

| Value | `\|{ a }\|` and every format option but those below | `XSD = YES` | `STYLE = …` |
|---|---|---|---|
| `f` ±Inf | `CX_SY_CONVERSION_OVERFLOW` | `INF`, `-INF` | 8200 asterisks |
| `f` NaN, either sign | `CX_SY_CONVERSION_OVERFLOW` | `NaN` | 8200 asterisks |
| decimal floating point | 8200 asterisks | `Infinity`, `-Infinity`, `NaN`, `-NaN` | 8200 asterisks |

The field of asterisks takes the format options like any other result: `WIDTH` pads it when it is larger and never
cuts it, `SIGN = LEFTPLUS` and `RIGHTPLUS` add a `+` and `LEFTSPACE` and `RIGHTSPACE` a blank, **also for
`-Infinity` and NaN**. The options covered by cells are `WIDTH`, `ALIGN`, `PAD`, `SIGN`, `NUMBER`, `DECIMALS`,
`ZERO`, `XSD`, `STYLE`, `EXPONENT`, `CURRENCY` and `COUNTRY`.

`WRITE` takes strings only, so it never formats a special value.

## Other statements

- `DO a TIMES` makes no pass and raises nothing, for every special value.
- As an offset or length of a subfield, an `f` special value raises `CX_SY_RANGE_OUT_OF_BOUNDS`. A decimal floating
  point special value counts as 0: as an offset it is accepted, as a length it raises.

## Runtime errors and statements that do not finish

| Outcome | Where |
|---|---|
| `RUNT_INTERNAL_ERROR` | `a MOD b` in `decfloat34` with both operands infinite |
| `CONVT_NO_NUMBER`, `CONVT_OVERFLOW` | comparisons with text, as above |
| does not finish | `ipow( )` calculated in `f` with base 1 and an `f` exponent `+Inf` |

How an executable ends in the first and the last case is to be decided when they are implemented.

## Implementation

What the runtime needs to close the gap listed in [aot_for_abap.md](../aot_for_abap.md):

- a decimal floating point value that holds the two infinities and a NaN of either sign;
- the sign of a NaN set by the runtime itself: processors differ in the NaN they make, and the sign can be seen;
- comparisons that tell a statically typed `f` pair, other data objects and arithmetic operands apart. This is a
  place where the static and the generic path differ by design, so the cells of a static comparison chosen at build
  time ([aot_for_abap.md](../aot_for_abap.md), "Static operands") have their own expected results.

## Open points

- Not covered yet: `SORT`, table keys, `READ TABLE`, `DELETE ADJACENT DUPLICATES`, `COLLECT`, parameter passing (a
  parameter of the same type is expected to take the value unchanged), Open SQL, `out->write( )` of a special value,
  the other built-in functions (trigonometric and hyperbolic functions, `round`, `rescale`).
- NaNs with other payloads can only come from casts onto raw bytes, which depend on ABAP's memory layout and are
  refused at build time.
- `ipow( )` with a special exponent has cells for the bases listed only.
