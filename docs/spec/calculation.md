# Calculation types and calculation rules of arithmetic expressions

The calculation type table of the rule-table specification ([roadmap.md](../roadmap.md), critical path): which
type an arithmetic expression is calculated in, how each operator calculates in that type, which exception it
raises, and what happens to the result. The structure follows the ABAP keyword documentation, *arith_exp -
Calculation Type and Calculation Rules* and *arith_exp - Arithmetic Operators*; the details below go further than
the documentation where it is silent (interim precision of `p`, `DIV` and `MOD` outside integers, signed zeros,
which exception a result that does not fit raises, the result handed to a text field).

**Status (2026-11-24): specified and implemented in the runtime** (`abap.Calculate`, `runtime/go/abap/calc.go`),
which passes every cell of the table; the compiler builds `result = expression.` and the assignment operators on
it. The test cases are
[`testdata/calculation.tsv`](../../runtime/go/abap/testdata/calculation.tsv) (2,269 cells). Each is a snippet: the
line

```
i	a / b * b	p8.2[1]	i[3]	-	1
```

stands for `DATA a TYPE p LENGTH 8 DECIMALS 2 VALUE '1'. DATA b TYPE i VALUE 3. DATA result TYPE i.
result = a / b * b.` with `1` as the expected content of `result`. The header of `calculation.tsv` explains the
format, which reads values as [`conversion.tsv`](../../runtime/go/abap/testdata/conversion.tsv) does.
Priority and the sign, and overflow in every place an expression is calculated (assignment operators, `ADD` and
its siblings, string templates, `CONV`, `EXACT`, inline declarations, the result field after an exception), are in
[`testdata/calculation_contexts.tsv`](../../runtime/go/abap/testdata/calculation_contexts.tsv) (699 cells; specified,
not run by the tests yet).

Throughout, **rounding** is half away from zero (commercial rounding), as in [conversion.md](conversion.md).

## 1. The calculation type

The calculation type is one of `i`, `int8`, `p`, `f` and `decfloat34`. Every data type involved has a rank; the
highest rank is the calculation type:

| Rank | Calculation type | Data types involved |
|---|---|---|
| 5 | `decfloat34` | `decfloat16`, `decfloat34` |
| 4 | `f` | `f`; the operator `**` (unless rank 5 is involved); a floating point function such as `sqrt` |
| 3 | `p` | `p` (any length and decimals), and the text types `c`, `n`, `string` |
| 2 | `int8` | `int8` |
| 1 | `i` | `i`, `b`, `s`, and `d`, `t`, `x`, `xstring` |

`utclong` cannot be an operand: `a + 1` with `a TYPE utclong` is a syntax error.

**Which data types are involved.** In `result = expression.` the operands of the whole expression *and the result
field*: `result TYPE p LENGTH 8 DECIMALS 2` makes `i_7 / i_2` a `p` calculation, so the result is `3.50`, while
the same expression into an `i` gives `4`. A `c`, `n` or `string` result field counts as `p`, a `d`, `t`, `x` or
`xstring` result field as `i`. Literals count with their type: a number literal is `i`, or `p` if it is beyond
the range of `i` (`3000000000`); a text literal `'2'` is `c` and a string literal `` `2` `` is `string`, so both
make the expression `p`. Parentheses, operators other than `**` and the order of the operands make no difference.

**Functions.** The operand of `abs( )` and the other overloaded numeric functions, and the base of `ipow( )`,
count as operands; the exponent of `ipow( )` does not (`ipow( base = i exp = p )` is calculated in `i`).

**Generic operands.** A field symbol or parameter typed `any` (or another generic type) counts with the type of
the data object it points to at run time: `<a> / 2 * 2` into an `i` is `8` for an `i`, `int8`, `x`, `d` or `t`
behind `<a>`, and `7` for a `p`, `c`, `n`, `string`, `f` or `decfloat34`.

**Inline declarations.** `DATA(result) = expression.` declares `result` with the type of the operands' calculation
type, the result field taking no part:

| Calculation type of the operands | Declared type |
|---|---|
| `i`, `int8`, `f` | the same |
| `p` | `p LENGTH 8 DECIMALS 0`, whatever the operands' decimals (`p8.2_1 / 3` gives `0`) |
| `decfloat34`, with only `decfloat16` among the decimal floating point operands | `decfloat16` |
| `decfloat34`, with a `decfloat34` operand | `decfloat34` |
| any operand of a generic type | `decfloat34` |

The calculation itself is still `decfloat34` when `decfloat16` is declared: `DATA(r) = d16_1 / i_3 * i_3.` gives
`1.000000000000000` (the 34-digit `0.99…9` rounded to 16 digits), and `d16 * 10` beyond the range of `decfloat16`
raises `CX_SY_CONVERSION_OVERFLOW`, the exception of the conversion into the declared type.

## 2. Operands

Before the calculation every operand is converted to the calculation type with the rules of
[conversion.md](conversion.md), and raises their exceptions:

- text (`c`, `n`, `string`) in a `p` calculation is read as a *number*: `'1.5'` is 1.5, `' 7 '` is 7, `'7-'` is -7,
  a blank text is 0, `'1E2'` and `'1,5'` raise `CX_SY_CONVERSION_NO_NUMBER`. In an `f` calculation the same text is
  read by the *float* rules (`'1E2'` is 100, `'1 2'` is 1, `'- 3'` is not a number), in a `decfloat34` calculation
  by the *number+E* rules (`'1E2'` is `1.00E+2`, `'1 2'` is not a number);
- `d` is its day number and `t` its number of seconds: `d '20240229' - d '20240101'` is 59, and the result moved to
  a `d` or `t` goes back by the same rules (`d '20240229' + 1` into a `d` is `20240301`, `t '235959' + 1` into a
  `t` is `000000`);
- `x` and `xstring` are read as an `i` (the last four bytes, signed): `x '0000000A'` is 10, `x 'FFFFFFFF'` is -1;
  in an `int8` calculation as an `int8` (the last eight bytes: `xstring 'FFFFFFFFFF'` is 1099511627775);
- `f` in a `p` or `decfloat34` calculation goes through its 17-digit decimal form (`f 0.1 + decfloat34 1` is
  `1.10000000000000001`), `int8` in an `f` calculation is rounded to the nearest `f`
  (`9007199254740993` becomes `9007199254740992`).

## 3. Calculation rules

### Operators

| Operator | Priority | Result |
|---|---|---|
| `+`, `-` | 1 | sum, difference |
| `*` | 2 | product |
| `/` | 2 | quotient; in `i` and `int8` rounded to an integer, half away from zero (`7 / 2` is 4, `-7 / 2` is -4, `5 / 2` is 3) |
| `DIV` | 2 | the integer *q* of the Euclidean division: `a = q * b + r` with `0 <= r < abs( b )` |
| `MOD` | 2 | the remainder *r* of the Euclidean division, never negative |
| `**` | 3, right to left | power (`2 ** 3 ** 2` is 512); makes the calculation type `f` or `decfloat34` |
| `-` (sign) | | the negative; `- a` |

**Priority and the sign.** From the strongest binding to the weakest:

1. `**`, from right to left;
2. the sign `-` (and `+`, which changes nothing) before an operand, also right after another operator
   (`a * - b`, `- - a`);
3. `*`, `/`, `DIV`, `MOD`, from left to right;
4. `+`, `-`, from left to right.

So a sign applies to the power, not to its base, also on the right of `**`: `- a ** b` is `-( a ** b )` (`- 7 ** 2`
is -49) and `b ** - c ** b` is `b ** -( c ** b )`. It binds more strongly than the multiplicative operators:
`- a MOD b` is `( - a ) MOD b` (`- 7 MOD 2` is 1, `- 7 DIV 2` is -4), `- a / b * c` is `( ( - a ) / b ) * c`. A
negative number literal is a single operand, not a sign: `-7 ** 2` is 49, `-2 ** 2 ** 3` is 256 and `- 2 ** 2 ** 3`
is -256. Left to right means `7 - 2 - 3` is 2, `7 / 2 * 3` is 10.5 in `p` and 12 in `i` (each division rounded),
`7 DIV 2 * 3` is 9, `7 MOD 2 * 3` is 3 and `7 * 2 DIV 3` is 4. The function operands (`abs( - a ) ** b`) and
parentheses (`( - a ) ** b`) bind as usual.

A sign makes the source an arithmetic expression, also a lone `+`, so the calculation type applies where a move
would convert: with `t` a text field holding `1.25`, `n = t` gives `0125` in an `n LENGTH 4` but `n = + t` calculates in
`p` and is expected to give `0001`. ABAP is expected to refuse `+a` written without a blank as a syntax error.

`DIV` and `MOD` for the four sign combinations: `7 DIV 3` is 2 and `7 MOD 3` is 1; `-7 DIV 3` is -3, `-7 MOD 3` is
2; `7 DIV -3` is -2, `7 MOD -3` is 1; `-7 DIV -3` is 3, `-7 MOD -3` is 2. The same holds with decimals:
`5.2 DIV 1.1` is 4 and `5.2 MOD 1.1` is 0.8, `-5.2 DIV 1.1` is -5 and `-5.2 MOD 1.1` is 0.3.

**Division by zero.** `/`, `DIV` and `MOD` by zero raise `CX_SY_ZERODIVIDE`, except when the dividend is zero too:
then the result is 0 (`0 / 0`, `0 DIV 0` and `0 MOD 0` are 0) in every calculation type. More generally a zero
dividend gives the plain zero of the calculation type without calculating (see `f` and `decfloat34` below).

**Overflow.** Every interim result is checked: an interim result beyond the range of the calculation type raises
`CX_SY_ARITHMETIC_OVERFLOW`, even when the final result would fit (`i 2147483647 + 1 - 1` into an `i` overflows, the
same into an `int8` gives 2147483647 because the `int8` target makes it an `int8` calculation).

### Calculation type i and int8

Integer arithmetic in 32 or 64 bits. Every interim result must be in the range of `i` (-2147483648 to 2147483647)
or `int8`, else `CX_SY_ARITHMETIC_OVERFLOW`; this includes `- a` and `abs( a )` of the smallest value and
`-2147483648 / -1`. A division rounds its quotient to an integer, half away from zero, at each step:
`1 / 3 * 3` is 0. `b` and `s` operands and targets calculate in `i`: `b 200 + b 100 - b 100` into a `b` is 200,
`b 200 + b 100` into a `b` raises `CX_SY_CONVERSION_OVERFLOW` when the result is moved.

### Calculation type p

Decimal arithmetic in which the decimal point of the operands is not fixed: every interim result is a decimal
floating point number with **31 significant digits**, rounded half away from zero at the 31st digit after each
operation. So `1 / 3` is `0.3333333333333333333333333333333` and `1 / 3 * 3 - 1` is `-1E-31`; `1E-10 / 3` keeps 31
significant digits, not 31 decimals (`( 1E-10 / 3 * 3 - 1E-10 ) * 1E40` is `-0.1`); `2 / 3` rounds up to
`0.666…667` and `2 / 3 * 3` rounds back to exactly 2.

If an interim result needs more than 31 digits before the decimal point (`9999999999999999999999999999999 + 1`), the
**whole expression is calculated again with 63 significant digits**; that precision then also applies to the other
interim results (`( 1 / 3 * 3 - 1 ) * 1E40 + b * 10 - b * 10` with a 31-digit `b` is 0, not `-1E9`). An interim result
needing more than 63 digits before the decimal point raises `CX_SY_ARITHMETIC_OVERFLOW`. Digits after the decimal
point are rounded off and never raise an exception.

`DIV` and `MOD` work on the exact values (`9999999999999999999999999999999 MOD 0.07` is 0.04). An `int8` and a `p`
in one expression calculate in `p`: `int8 9223372036854775807 + p 0.5` into a `p LENGTH 16 DECIMALS 2` is
`9223372036854775807.50`; into an `int8` it raises `CX_SY_ARITHMETIC_OVERFLOW`, the rounded result being out of range.

**The scale of an interim result.** Besides its value, an interim result has a number of decimals, which shows
only when a result goes into a `string` (section 4); a `c` target drops trailing zeros, and the other targets have
decimals of their own. An operand has the decimals of its type (a `p`) or of its text (`'0.5'` has one), an integer
none. A sum or difference has the larger number of decimals of its two operands. An exact quotient or remainder
has no trailing zeros after the decimal point but keeps the zeros before it (`600 / 6` is `100`, `5.20 / 2.00` is
`2.6`), `DIV` gives an integer, a zero has no decimals, and an inexact result has all the decimals that fit.

The scale of a product follows the bytes of a packed number, as far as we know: digits count in pairs. Let `d` be
the number of decimals of the two factors together, and let each factor whose digits end in `t` zeros (counted on
all its digits at its scale: `2.00` is 200, two zeros; `20.00` is 2000, three) have `ceil( t / 2 )` pairs of zeros.
The product then has `d + 1` decimals, less two for every such pair of both factors but one, and no fewer than zero:

| Product | `d + 1` | Pairs | Result |
|---|---|---|---|
| `2.5 * 2.5`, `7 * 3`, `0.7 * 0.03` | 3, 1, 4 | 0 + 0 | `6.250`, `21.0`, `0.0210` |
| `2.00 * 1`, `1.10 * 1` | 3 | 1 + 0 | `2.000`, `1.100` (one pair, so none taken off) |
| `2.00 * 2.00`, `1.10 * 1.10` | 5 | 1 + 1 | `4.000`, `1.210` |
| `2.0 * 2.0` | 3 | 1 + 1 | `4.0` |
| `2.000 * 2.000`, `1.50 * 2.000` | 7, 6 | 2 + 2, 1 + 2 | `4.0`, `3.00` |
| `20.00 * 1`, `20.0 * 10` | 3, 2 | 2 + 0, 1 + 1 | `20.0`, `200` (not below zero decimals) |

The length of the factors makes no difference, nor does their type (an `i`, `int8`, text or a literal counts with
its value and its decimals: `2.00 * '0.5'` is `1.0000`). The product is an interim result with that scale for
the next operation: `2.00 * 2.00 * 2.00` is `4.000 * 2.00` = `8.00`, `( 2.00 * 2.00 ) * ( 2.00 * 2.00 )` is
`4.000 * 4.000` = `16.0`, and `5.00 * 1.0 + 2.000` is `5.00 + 2.000` = `7.000`.

### Calculation type f

Binary floating point arithmetic (IEEE 754 double precision, rounding to nearest even). An interim result beyond
the range of `f` raises `CX_SY_ARITHMETIC_OVERFLOW` (`1E300 * 1E300 / 1E300`); one below it becomes a subnormal number
or 0 without an exception (`1E-308 * 1E-10` is subnormal, `1E-308 * 1E-20` is 0).

- A zero dividend gives +0, whatever the sign of the divisor (`0 / -2` is +0); `- a` is `0 - a`, so `- 0` is +0;
  otherwise signed zeros follow IEEE 754 (`0 * -2` is -0). Note that an `f` set from the text `-0` is +0.
- `DIV` is the Euclidean quotient as an `f` integer value (`7.5 DIV 2` is 3, `-7.5 DIV 2` is -4, `1 DIV -2` is -0);
  a quotient beyond the range of `f` raises `CX_SY_ARITHMETIC_OVERFLOW` (`1E308 DIV 0.1`).
- `MOD` is `a - b * q` calculated in `f` with that quotient: `7.5 MOD 0.1` is 0 and `1 MOD 1E-308` is
  `1.1102230246251565E-16`, the rounding of the binary values showing. When the quotient is beyond the range of `f`
  and positive, `MOD` is 0 (`7.5 MOD 1E-308`, `1E308 MOD 0.1`); when it is negative, `MOD` raises
  `CX_SY_ARITHMETIC_OVERFLOW` (`-7.5 MOD 1E-308`).

### Calculation type decfloat34

Decimal floating point arithmetic as IEEE 754-2008 decimal128 (34 significant digits, exponents -6176 to 6111 of
the last digit), with rounding half away from zero. Interim results keep a scale (an exponent):

- an exact result of `+` and `-` has the smaller exponent of the two operands (`5.2 + 1.00` is `6.20`, `1.00 - 1.00`
  is `0.00`); `*` adds the exponents (`5.2 * 1.00` is `5.200`, `5.2 * 0` is `0.0`); `/` takes the exponent of the
  dividend minus that of the divisor when the quotient is exact with it (`6 / 2` is `3`, `1.00 / 1.0` is `1.0`,
  `100 / 1E2` is `1.00`) and otherwise the exponent closest to it that makes the quotient exact (`1 / 4` is `0.25`,
  `1E2 / 4` is `25`, `5.2 / 1.00` is `5.2`); `sqrt` takes half the exponent of its operand, rounded down
  (`sqrt( 4.00 )` is `2.0`); an inexact result has 34 digits (`2 / 3` is `0.6666666666666666666666666666666667`);
- an exponent beyond 6111 is folded into the coefficient where it has room (`5.2 / 1E-6143` is `5.2E+6143` with 33
  digits); a result too large for that raises `CX_SY_ARITHMETIC_OVERFLOW` (`9.99…9E6144 * 10`, `1E6144 / 1E-6143`);
  a result too small becomes zero with the smallest exponent without an exception (`1E-6176 / 10` is `0E-6176`);
- a zero dividend gives `0` with exponent 0 (`0 / 1.1` and `0 / 1E-6143` are `0`); otherwise signed zeros follow IEEE
  754: `-0 + 0` is 0, `-0 + -0` is -0, `0 * -1` is -0, and `- 0` is -0 (unlike `f`);
- `DIV` is the quotient `a / b` (34 digits, as for `/`) rounded to an integer in the direction of the Euclidean
  division, with exponent 0 unless the quotient already has a larger one: `5.2 DIV 1.1` is `4`, `1.00 DIV -1.1` is
  `-0`, `1E6144 DIV 3` is `3.333333333333333333333333333333333E+6143`;
- `MOD` is `a - b * q` calculated in `decfloat34` with that quotient, so it has the scale those operations give:
  `5.2 MOD 1.1` is `0.8`, `5.2 MOD 1.00` is `0.20`, `1.00 MOD 1.1` is `1.00`, `1E6144 MOD 3` is `1E+6110`,
  `5.2 MOD 1E-6143` is `0E-32`.

### ** and ipow( )

`a ** b` calculates in `f` (or `decfloat34` if a decimal floating point number is involved), so `2 ** 31` into an
`i` raises `CX_SY_CONVERSION_OVERFLOW` when the `f` result is moved, and `int8 3 ** 39` into an `int8` gives
`4052555153018976256`, the nearest `f`.

| Case | `f` | `decfloat34` |
|---|---|---|
| `0 ** 0` | 1 | `1` |
| `0 ** b`, b > 0 | 0 | `0` |
| `0 ** b`, b < 0 | `CX_SY_ARITHMETIC_OVERFLOW` | `CX_SY_ARG_OUT_OF_DOMAIN` |
| negative `a`, `b` not an integer | `CX_SY_ARG_OUT_OF_DOMAIN` | `CX_SY_ARG_OUT_OF_DOMAIN` |
| negative `a`, `b` an integer | the signed power (`-8 ** 3` is -512) | the same (`-512`) |
| result beyond the range | `CX_SY_ARITHMETIC_OVERFLOW` (`2 ** 1024`) | `CX_SY_ARITHMETIC_OVERFLOW` (`1E3000 ** 3`) |
| result below the range | 0 (`10 ** -400`) | the exact value if it has room (`1E-400`) |

In `decfloat34`, an integer exponent multiplies exactly with the scale rules of `*` (`1.10 ** 3` is `1.331000`,
`1.0 ** 2` is `1.00`, `2 ** 1024` is 2^1024 rounded to 34 digits); a negative integer exponent is `1 / a ** abs( b )`
(`1.10 ** -1` is `0.9090909090909090909090909090909091`); any other exponent gives 34 digits (`4 ** 0.5` is
`2.000000000000000000000000000000000`).

`ipow( base = a exp = n )` calculates in the calculation type of the expression it stands in (the base counts, the
exponent does not). The exponent is converted to an `i` first, rounded (`2.5` becomes 3, `'3.5'` becomes 4). The
power is the product of `abs( n )` factors `a`, each an interim result checked for overflow (`ipow( 2, 31 )` into an
`i` raises `CX_SY_ARITHMETIC_OVERFLOW`, into an `int8` it is 2147483648); `n = 0` gives 1 (also for `a = 0`); a
negative `n` gives `1 / ipow( a, abs( n ) )`, so in `i` `ipow( 2, -1 )` is 1 (0.5 rounded), `ipow( -2, -1 )` is -1,
`ipow( 2, -2 )` is 0, a zero base raises `CX_SY_ARITHMETIC_OVERFLOW` (in every calculation type) and so does a
denominator out of range (`ipow( 10, -400 )` in `p`, `ipow( f 2, -1074 )` in `f`). In `p` the factors are expected
to be taken by squaring, which decides the scale of the power (see *Calculation type p*): starting
from a 1 without decimals, the result is multiplied by `a`, `a * a`, `( a * a ) * ( a * a )`, … for each bit of
`abs( n )` that is set, from the lowest. So `ipow( 2.00, 1 )` is `1 * 2.00` = `2.000` and `ipow( 2.00, 3 )` is
`2.000 * 4.000` = `8.0`. A zero base with `n > 0` gives the base itself, with its decimals (`ipow( 0.00, 2 )` is
`0.00`).

### Functions

The numeric functions calculate in the calculation type: `abs( i -2147483648 )` raises
`CX_SY_ARITHMETIC_OVERFLOW`. A floating point function (`sqrt`, …) makes the calculation type `f` unless a decimal
floating point number is involved (`DATA(r) = sqrt( i )` is an `f`; with a `decfloat16` operand a `decfloat16`).

## 4. The result

**Into an existing data object.** The result of the calculation type is moved to the result field by the rules of
[conversion.md](conversion.md), with their exceptions (`f 1E10` into an `i`: `CX_SY_CONVERSION_OVERFLOW`; `i 1000`
into an `n LENGTH 3`: `000`; `f 1000` into a `c LENGTH 3`: `***`; `decfloat34 1000` into an `n LENGTH 3`:
`CX_SY_CONVERSION_OVERFLOW`). Three cases differ:

- **calculation type f, int8 target**: the `f` result goes into the `int8` with its exact binary value, rounded half
  away from zero (`int8 3 ** 39` gives `4052555153018976256`, `int8 9007199254740993 + f 0` gives
  `9007199254740992`), not through the 17-digit decimal form the conversion of an `f` data object uses
  (which would give `4052555153018976300`).

- **calculation type p, result out of range**: where the conversion would raise `CX_SY_CONVERSION_OVERFLOW` (an `i`,
  `int8`, `b`, `s` or `p` target, or a `d`, `t`, `x`, `xstring` target through `i`), a `p` calculation raises
  `CX_SY_ARITHMETIC_OVERFLOW` (`p 3000000000 + 0` into an `i`, `p 300 + 0` into a `b`, `int8 max + p 0.5` into an
  `int8`). The other calculation types raise `CX_SY_CONVERSION_OVERFLOW` (`int8 3000000000 + 0` into an `i`,
  `b 200 + b 100` into a `b`). Rounding to the target's decimals is half away from zero (`2 / 3` into a
  `p LENGTH 8 DECIMALS 2` is 0.67, `p -2.5 + 0` into an `i` is -3).
- **calculation type p, text target** (`c` and `string`). The result is first a decimal number with at most 31
  digits and at most 14 decimals: the exact result if it fits, else rounded half away from zero to as many decimals
  as fit (14, fewer beyond 17 integer digits: `1E27 / 3` is `333333333333333333333333333.3333`). More than 31 integer
  digits raise `CX_SY_ARITHMETIC_OVERFLOW` (`9999999999999999999999999999999 + 1` into a `string`, although it fits a
  63-digit interim result). A value that becomes 0 by this rounding loses its sign (`-1E-17` gives zero, without `-`).
  A rounding that carries into one more digit costs a decimal (`p 99999999999999999 + c '0.999999999999999'` into a
  `string` is `100000000000000000.0000000000000 `, with 13).
  - into a **c** field of length *L*: a result with more decimals than the 14 (or fewer) above is rounded only to
    the decimals the field can show at all, *L* - 2 if that is fewer, and loses its sign if that gives zero
    (`-1 / 3` in a `c LENGTH 2` is `0 ` and in a `c LENGTH 1` is `0`, while `-1 / 8`, exact, gives `0-` and `-`).
    Then trailing zeros of the decimals are dropped (`1.10 + 1.00` gives `2.1`,
    `2.00 * 2.00` gives `4`, `1 / 3 * 3` gives `1`); if the number does not fit, its decimals are rounded off one by
    one, again dropping trailing zeros, until it fits (`1 / 3` in a `c LENGTH 3` is `0.3`, `1 / 1000` in a
    `c LENGTH 4` is `0`, `9999 / 10` in a `c LENGTH 4` is `1000`); a negative value rounded to 0 keeps its sign
    (`-1 / 1000` in a `c LENGTH 2` is `0-`). The text is then placed as the conversion of a `p` does: right-aligned
    with the sign character (`-` or a blank) at the end, a positive number dropping its blank if that makes it fit;
    a number that still does not fit with no decimals gets the `*` of that conversion (`123456` in a `c LENGTH 4`
    is `*456`, `-1 / 8` in a `c LENGTH 1` is `-` with the leading 0 dropped);
  - into a **string**: an inexact result has all its decimals (`1 / 3` is `0.33333333333333 `, `1 / 3 * 3` is
    `1.00000000000000 `); an exact sum or difference of two operands has the larger number of decimals of the two
    (`1.10 + 1.00` is `2.10 `, `1.50 - 2.000` is `0.500-`), an exact quotient, `DIV` or `MOD` no trailing zeros
    (`5.20 / 2.00` is `2.6 `, `7.10 MOD 3.00` is `1.1 `), a zero result no decimals (`1.00 - 1.00` is `0 `), an
    exact product the scale of *Calculation type p* (`2.00 * 2.00` is `4.000 `, `2.0 * 2.0` is `4.0 `). As for any
    `p` moved into a `string`, the sign character follows the number;
  - an `n` target takes the rounded integer as the conversion of a `p` does (`2 / 3` into an `n LENGTH 3` is
    `001`).

**Into an inline declaration**: the declared type of section 1, then moved by the conversion rules.

**Assignment operators.** `result += a.` (and `-=`, `*=`, `/=`) is `result = result + ( a ).`: the result field is an
operand and the target (`r TYPE p LENGTH 8 DECIMALS 2 VALUE '1.00'`, `r += 1 / 3` gives 1.33; `r TYPE i VALUE 1`,
`r += p 0.5` gives 2; `r /= 0` raises `CX_SY_ZERODIVIDE`, unless `r` is 0). The statements `ADD a TO r`,
`SUBTRACT a FROM r`, `MULTIPLY r BY a` and `DIVIDE r BY a` are the same as `r += a`, `r -= a`, `r *= a` and `r /= a`,
exceptions included.

**Other places an expression is calculated.** The rules hold wherever an arithmetic expression stands, with the
calculation type taken from the operands and from what the result goes into:

| Place | Data types involved besides the operands |
|---|---|
| `result = expression`, assignment operators, `ADD`, `SUBTRACT`, `MULTIPLY`, `DIVIDE` | the result field |
| `DATA(result) = expression` | none (section 1) |
| `CONV type( expression )`, `EXACT type( expression )` | `type` |
| an embedded expression of a string template, `|{ expression }|` | none: `|{ i_7 / 2 }|` is `4`, `|{ c_7 / 2 }|` is `3.5` |
| an operand of a relational expression | the operands of the whole comparison, see [comparison.md](comparison.md) |
| the operand of `CASE` | none: the values after `WHEN` take no part, see [comparison.md](comparison.md), "CASE" |
| `DO expression TIMES` | `i`, as for a result field (`DO p_5 / p_2 TIMES` runs 3 passes, `DO i_7 / i_2 TIMES` 4) |

So an overflow raises the same exception in all of them: `|{ i_max + 1 }|` and `CONV i( i_max + 1 )` raise
`CX_SY_ARITHMETIC_OVERFLOW` as `r = i_max + 1` into an `i` does, and `ADD 1 TO r` with `r` at the largest `int8`
does too. A `p` result of an embedded expression is formatted as for a `string` target (`|{ p_7.00 / 3 }|` is
`2.33333333333333`); the other formatting of embedded expressions belongs to the string templates of the output
formatting table.

**The result field after an exception.** When the calculation raises an exception (`CX_SY_ARITHMETIC_OVERFLOW`,
`CX_SY_ZERODIVIDE`, `CX_SY_CONVERSION_NO_NUMBER`), the result field keeps its value: `r = i_max + 1` leaves `r` as it
was, and so do `r += 1`, `ADD 1 TO r` and `DIVIDE r BY 0`. When the result is calculated but does not fit the result
field (`CX_SY_CONVERSION_OVERFLOW`, and `CX_SY_ARITHMETIC_OVERFLOW` of a `p` calculation), an integer result field
can be left with a value: see [conversion.md](conversion.md), "The target after an exception". An `int8` result
keeps an `i` result field, unlike the conversion of an `int8` data object.

**EXACT.** `EXACT type( arithmetic expression )` calculates as above and raises `CX_SY_CONVERSION_ROUNDING` instead of
rounding, in an interim result or when the result is moved into `type`: `EXACT p8_2( p 1 / 4 )` is 0.25,
`EXACT p8_2( 1 / 8 )`, `EXACT i( 1 / 4 )` and `EXACT decfloat34( 1 / 3 )` raise it, `EXACT i( 4 / 2 )` is 2. An `f`
anywhere in the expression or as the type is a syntax error.

## Exceptions

| Exception | Raised by |
|---|---|
| `CX_SY_ARITHMETIC_OVERFLOW` | an interim result out of range in any calculation type; in `p`, also a result that does not fit its target; `0 ** negative` in `f`; `ipow` with a zero base and a negative exponent |
| `CX_SY_CONVERSION_OVERFLOW` | the move of an `i`, `int8`, `f` or `decfloat34` result into a target it does not fit |
| `CX_SY_ZERODIVIDE` | `/`, `DIV`, `MOD` and `/=` by zero with a dividend other than zero |
| `CX_SY_ARG_OUT_OF_DOMAIN` | `**` with a negative base and a non-integer exponent; `0 ** negative` in `decfloat34` |
| `CX_SY_CONVERSION_NO_NUMBER` | a text operand that is not a number by the rules of the calculation type |
| `CX_SY_CONVERSION_ROUNDING` | `EXACT` when a value would be rounded |

## Open points

- Sums with an inexact interim result into a `string` (`a / b + c`): the scale of *Calculation type p* is expected
  to apply, but the test cases have sums and products of exact interim results only.
- Not covered yet: `COLLECT` (sums of numeric components), arithmetic expressions in relational expressions (their
  calculation type is also the comparison type and belongs with the comparison table), actual parameters of methods
  and function modules, and the built-in functions other than `abs`, `sqrt` and `ipow`.
