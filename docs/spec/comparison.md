# Comparisons and logical expressions

The comparison table of the rule-table specification ([roadmap.md](../roadmap.md), critical path): which
*comparison type* two operands are compared in, how each comparison type compares, what happens when an operand
cannot be converted, how arithmetic expressions take part, and how relational expressions combine into logical
expressions. The structure follows the ABAP keyword documentation, *rel_exp - Comparison Type of Elementary Data
Objects* (and its pages per kind), *rel_exp - Comparison Rules for Comparison Types*, *rel_exp - Comparison Type of
Arithmetic Expressions* and *log_exp - Boolean Operators and Parentheses*; the details below go further than the
documentation where it is silent (rounding of a text compared with an integer, which conversion errors end the
program, length adjustments, short-circuit evaluation).

**Status (2026-11-26): specified; the comparison of two data objects is implemented in the runtime**
(`abap.Compare`, `runtime/go/abap/compare.go`), which passes every cell. The test cases are
[`testdata/comparison.tsv`](../../runtime/go/abap/testdata/comparison.tsv), every ordered pair of 162 values over all
elementary kinds (26,244 cells), and
[`testdata/comparison_random.tsv`](../../runtime/go/abap/testdata/comparison_random.tsv), 3,000 random pairs held
out while the rules were worked out, which the runtime passed without a change. Logical expressions, arithmetic
operands, literals and syntax errors are in
[`testdata/comparison_expr.tsv`](../../runtime/go/abap/testdata/comparison_expr.tsv) (404 cells). Since 2026-11-25
the compiler compiles them as `IF` (`test/comparison_expr.test.ts`): 340 cells run end to end and pass, arithmetic
operands on `abap.CompareCalculated` (`compare_calc.go`) and built-in functions on `abap.ValueOf` (`function.go`);
the others wait for predicates, `CONV`, `boolc( )`, `xsdbool( )`, `utclong_current( )` and `abap_true`. A line of
`comparison.tsv`

```
c10	[1-]	i	[-1]	=
```

stands for a `c LENGTH 10` holding `1-` compared with an `i` holding -1: they are equal, so `a = b`, `a <= b` and
`a >= b` are true and `a < b`, `a > b`, `a <> b` false. A line of `comparison_expr.tsv`

```
a / 2 = 4	a=int8[7]	T
```

stands for `DATA a TYPE int8 VALUE 7. IF a / 2 = 4.` with the expected outcome true. The headers of both files explain
the format.

## 1. The comparison type

Two elementary operands are compared in their *comparison type*; an operand of another type is converted to it.
The table is that of the keyword documentation (per kind: numeric, character-like, byte-like, date and time). `-`
means the two cannot be compared (section *Syntax errors*).

| a \ b | d16, d34 | f | p | int8 | i, s, b | c | string | n | x | xstring | d | t | utcl |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **d16, d34** | d34 | d34 | d34 | d34 | d34 | d34 | d34 | d34 | d34 | d34 | d34 | d34 | - |
| **f** | d34 | f | f | f | f | f | f | f | f | f | f | f | - |
| **p** | d34 | f | p | p | p | p | p | p | p | p | p | p | - |
| **int8** | d34 | f | p | int8 | int8 | int8 | int8 | int8 | int8 | int8 | int8 | int8 | - |
| **i, s, b** | d34 | f | p | int8 | i | i | i | i | i | i | i | i | - |
| **c** | d34 | f | p | int8 | i | c | string | p | c | string | c | c | utcl |
| **string** | d34 | f | p | int8 | i | string | string | p | string | string | string | string | utcl |
| **n** | d34 | f | p | int8 | i | p | p | n | p | p | n | n | - |
| **x** | d34 | f | p | int8 | i | c | string | p | x | xstring | i | i | - |
| **xstring** | d34 | f | p | int8 | i | string | string | p | xstring | xstring | i | i | - |
| **d** | d34 | f | p | int8 | i | c | string | n | i | i | d | - | - |
| **t** | d34 | f | p | int8 | i | c | string | n | i | i | - | t | - |
| **utcl** | - | - | - | - | - | utcl | utcl | - | - | - | - | - | utcl |

`s` with `s` or `b` is `s`, `b` with `b` is `b`; they compare like `i`. A comparison type `p` has 31 digits and the
larger number of decimals of the `p` operands (0 if none is a `p`).

**Generic operands** (`TYPE any`, `TYPE data`, …) take part with the type of the data object behind them at run time,
with the same results as the same types written statically; only a pair without a comparison type behaves
differently (a runtime error instead of a syntax error).

## 2. Numeric comparison types

The values are compared. Each operand is converted to the comparison type by the rules of
[conversion.md](conversion.md), with these differences and additions:

- **Text in `i` or `int8`** (`c`, `string`, `n`): read as a *number* (the rules of conversion.md: blanks around it,
  a sign in front or at the end, a decimal point, no exponent), rounded half away from zero to an integer, and
  compared **without a range**: `c '2147483648'` is greater than `i 2147483647`, `c '1-'` equals `i -1`,
  `c '7.4'` equals `i 7`, `c '7.5'` is greater (8), `c ' -83.954'` is less than `int8 -83` (-84).
- **Text in `p`**: converted to a `p` with 31 digits and the decimals of the comparison type, so rounded to them:
  `string '30.426'` equals `p8.2 30.43`, `c '-21.431'` equals `p3.1 -21.4`. More than 31 digits before the decimals
  is the runtime error `CONVT_OVERFLOW` (`c '12345678901234567890123456789012'` against any `p`). An `n` is read as
  its digits, up to 31 of them, whatever the decimals. `n` with `c` or `string` compares in `p` with 0 decimals.
- **Text in `f`** is read by the *float* rules (`c '1E1'` equals `f 10`), **text in `decfloat34`** by the *number+E*
  rules (`c '1E1'` equals `decfloat34 10`).
- A text that is not a number for these rules is the runtime error `CONVT_NO_NUMBER` (`c 'abc'`, `c '1 2'`,
  `string '2024-02-29 12:00:00'`, and `c '1E1'` against an integer or `p`). A blank text is 0.
- **x and xstring** are the integer of their last four bytes, signed (`x4 'FFFFFFFF'` is -1), or of their last eight
  bytes in `int8`; in `p`, `f` and `decfloat34` the four-byte integer.
- **d** is its day number and **t** its number of seconds, as in conversion.md (an invalid date is 0).
- **f**: the operands are converted to `f`, an `int8` to the nearest `f` (`int8 9007199254740993` equals
  `f 9007199254740992`), a `p` to the nearest `f`.
- **decfloat34**: an `f` operand goes through its 17-digit decimal form (`f 0.1` equals
  `decfloat34 0.10000000000000001`, not `decfloat34 0.1`; `CONV f( '0.15' ) = CONV decfloat34( '0.15' )` is false),
  the others are exact. The scale does not count: `decfloat34 7.00` equals `decfloat34 7`, and -0 equals 0.
- `p` with `p`, `int8` or `i`, and `int8` with `i`, are compared exactly, whatever the lengths and decimals.

## 3. Character-like comparison types

The characters are compared from the left by their code, the first difference deciding (`'a'` is greater than
`'Z'` and `'B'`); a blank is less than any digit or letter. Before that:

- **c**: the shorter operand is padded with blanks on the right, so trailing blanks never count (`c2 '7'` equals
  `c10 '7'`).
- **string**: a `c` operand loses its trailing blanks first (`c '7'` equals `` `7` `` but is less than `` `7 ` ``); of
  two strings that agree up to the end of the shorter one, the shorter one is less (`` `ab` `` < `` `ab ` ``).
  `boolc( 1 = 2 ) = abap_false` is false for this reason: the blank of `abap_false` is lost.
- **n** with **n**: the shorter is padded with zeros on the left (`n4 '0007'` equals `n10 '0000000007'`).
- **x** or **xstring** with **c** or **string**: the bytes become their hexadecimal digits in upper case
  (`x4 '00000007'` equals `c10 '00000007'`, `x4 'FFFFFFFF'` is greater than `c10 'FF'`), then as above.
- **d or t with c, n or string**: with `c` or `n`, if the lengths differ, the longer operand is cut to the length of
  the shorter one when only blanks are cut (for a `t` also zeros: `t '120000'` equals `c '12'` and `n4 '1200'`,
  `d '20240229'` equals `c '20240229  '`); otherwise the shorter one is padded with blanks, also an `n`
  (`n4 '0000'` is less than `d '00000000'`, `n4 '0007'` greater than `d '00010108'`). With a `string`, a `d` is
  compared as it is; for a `t` a string shorter than six characters is first padded with zeros on the right
  (`` `12` `` equals `t '120000'` and is greater than `t '12    '`, `` `` `` equals `t '000000'`), a longer one is
  compared as it is.
- **d** with **d** and **t** with **t** compare their characters: a valid later date or time is greater.

## 4. Byte-like and time stamp comparison types

- **x** with **x**: the shorter is padded with 00 bytes on the right, then the bytes are compared.
- **xstring**: an `x` operand keeps all its bytes; of two byte strings that agree up to the end of the shorter one,
  the shorter one is less (`x8 '0102000000000000'` is greater than `xstring '0102'`).
- **utclong**: the points in time are compared, the initial value being less than any other. A `c` or `string`
  operand is converted by the *stamp* rules of conversion.md (an empty or blank text is the initial value); a text
  that is not a time stamp is the runtime error `CONVT_NO_DATETIME`.

## Arithmetic expressions as operands

An arithmetic expression can be compared with a numeric single operand or with another arithmetic expression. The
calculation type of all arithmetic expressions in one comparison is determined from **all operands of both sides**
by the rules of [calculation.md](calculation.md) (there is no result field), and that calculation type is also the
comparison type. Each relational expression of a logical expression has its own.

- `int8_7 / 2 = 4` is true: `int8` and `i` calculate in `int8`, and `/` rounds 3.5 to 4. `int8_7 / 2 = p_3.50` is
  true as well, because the `p` operand makes the whole comparison a `p` calculation, so is `int8_7 / 2 = f_3.5`, and
  `int8_7 / 2 = 4 AND int8_7 / 2 = + '3.5'` is true: two relational expressions, two calculation types.
- `i_7 / 2 = i_8 / 2` is true (4 = 4 in `i`); with a `p` operand of value 0 added on either side it is false (3.5 and
  4 in `p`).
- `i_4 / 3 = 1` is true, `i_4 / 3 > CONV decfloat34( 1 )` is true (1.33… in `decfloat34`), `i_4 / 3 > CONV int8( 1 )`
  is false (1 in `int8`).
- `i_1 / 3 * 3 = CONV p8_2( 1 )` is true (31 digits rounded back in `p`), with `CONV decfloat34( 1 )` it is false
  (0.99…9 with 34 digits), with `CONV f( 1 )` true; `2 ** '0.5' * 2 ** '0.5' = 2` and `sqrt( 2 ) * sqrt( 2 ) = 2` are
  false in `f`.
- A result in `p` is compared as a number of at most 31 digits and at most 14 decimals, rounded half away from zero
  as for a text target ([calculation.md](calculation.md), section 4); more than 31 digits before the decimal point
  raise `CX_SY_ARITHMETIC_OVERFLOW`, although the interim results may have 63 (`p_max + 1 > 0`).
- `BETWEEN` and `NOT BETWEEN` are two comparisons, each with the same calculation type, taken from all three
  operands: `i_7 / 2 BETWEEN 4 AND 4` is true, `i_7 / 2 BETWEEN + '3.5' AND + '3.5'` is true (calculation type `p`).
  As with data objects, the upper bound is not evaluated when the operand is below the lower bound.

**A non-numeric single operand** compared with an arithmetic expression is a syntax error, whatever its kind: a
`c`, `string`, `n`, `d`, `t`, `x`, `xstring` or `utclong` variable and a text or string literal
(`int8_7 / 2 = '3.5'` does not compile). Written with a sign it is an arithmetic expression itself and takes part in
the calculation type: `int8_7 / 2 = + '3.5'` is true (calculation type `p`), `+ c_'1.5' = 2` is false (1.5 in `p`).
A `utclong` cannot be an operand of an arithmetic expression at all (`+ u` is a syntax error). An arithmetic
expression cannot be the operand of a predicate expression (`i + 0 IS INITIAL` is a syntax error).

**Exceptions.** In an arithmetic expression, a conversion error is the catchable exception of the calculation, not a
runtime error: `+ c_'abc' = 0` raises `CX_SY_CONVERSION_NO_NUMBER`, and so does `+ c_'1E1' = 10` (a `p` calculation
reads text without an exponent), while `+ c_'1E1' = CONV f( 10 )` is true (an `f` calculation reads it). Overflow
follows the calculation type of the whole comparison: `i_max + 1 > 0` raises `CX_SY_ARITHMETIC_OVERFLOW`, while
`i_max + 1 > int8_0`, `i_max + 1 > p_0` and `i_max + 1 > + '0'` are true, and `i_max + 1 > 3000000000` is false (the
literal is a `p`, so the calculation is). `int8_max + 1 > 18446744073709551615` is false without an exception for the
same reason; `int8_max + 1 > 0` raises. `decfloat34_max + 1 > 0` is true (the sum rounds back to the largest value),
`decfloat34_max * 10 > 0` raises. `/`, `DIV` and `MOD` by zero raise `CX_SY_ZERODIVIDE` unless the dividend is 0.

## Logical expressions

Relational expressions are combined with `NOT`, `AND`, `OR` and `EQUIV` and with parentheses. Without parentheses
they bind in this order:

1. `NOT` with the relational expression (or parenthesized expression) on its right;
2. `AND`;
3. `OR`;
4. `EQUIV`;

each from left to right. So `NOT a AND b` is `( NOT a ) AND b`, `a OR b AND c` is `a OR ( b AND c )`, `a EQUIV b OR c`
is `a EQUIV ( b OR c )` and `a AND b EQUIV c` is `( a AND b ) EQUIV c`. `comparison_expr.tsv` has 25
combinations for all eight assignments of three truth values.

**Evaluation order.** The relational expressions of one parenthesis level are evaluated from left to right, and
evaluation stops as soon as the value of that level is known: with `x = 1`, `x = 1 OR 1 / z = 1` is true without
evaluating `1 / z` (so `z = 0` raises nothing), and with `x = 0`, `x = 1 AND 1 / z = 1` is false without it. The
operand that decides must be on the left: `1 / z = 1 OR x = 1` raises `CX_SY_ZERODIVIDE`. Both sides of `EQUIV`
are always evaluated. The skipped part is not evaluated at all: no functional method is called, no conversion or
arithmetic exception is raised. `a BETWEEN b AND c` is `a >= b AND a <= c` in this respect: with `a` below `b`, `c`
is not evaluated (`5 BETWEEN 6 AND c_'abc'` is false, without `CONVT_NO_NUMBER`).

## Literals and constructor expressions

Literals are operands with their own type: a text literal `'…'` is a `c` of its length, a string literal `` `…` ``
a `string`, a number literal an `i`, or a `p` if it is beyond the range of `i` (`int8_max < 18446744073709551615` is
true, compared in `p`; `i_max < 3000000000` is true). A negative number literal (`-1`) is a number, so `-1 = '1-'` is
true (comparison type `i`, the text `1-` is -1) while `'-1' <> '1-'` is true (comparison type `c`). Built-in
functions and constructor expressions are operands with the type of their result: `boolc( 1 = 2 ) = abap_false` is
false (a `string` holding a blank against a `c` that becomes the empty string), `xsdbool( 1 = 2 ) = abap_false` is
true, `CONV t( '120000' ) = '12'` is true, `CONV f( '0.15' ) = CONV decfloat34( '0.15' )` is false.

## Built-in functions as operands

A built-in function of a single data object is not an arithmetic expression: its result is a value of its own, which
is compared by the rules of two data objects (sections 1 to 4), so `strlen( s ) = '3'` compares an `i` with a `c`.
For the numeric functions the argument decides the type of the result, per the keyword documentation:

| Function | Argument | Type of the result |
|---|---|---|
| `strlen( )` | `c`, `n`, `d`, `t`, `string` | `i` |
| `abs( )` | `i`, `b`, `s`, `d`, `t`, `x`, `xstring` | `i` |
| `abs( )` | `int8`, `p`, `f`, `decfloat16`, `decfloat34` | that of the argument (decimal floating point: compared in `decfloat34`) |
| `abs( )` | `c`, `n`, `string` | `p` |
| `sqrt( )` | `decfloat16`, `decfloat34` | `decfloat34` |
| `sqrt( )` | any other | `f` |

- The function is calculated in the calculation type of its argument alone, whatever it is compared with, and its
  errors are the catchable exceptions of the calculation: `abs( i_min ) = int8_0` raises
  `CX_SY_ARITHMETIC_OVERFLOW`, `abs( c_'abc' ) = 0` and `abs( c_'1E1' ) = f_10` raise
  `CX_SY_CONVERSION_NO_NUMBER` (text is read as for a `p` calculation), `sqrt( i_-1 ) = 0` raises
  `CX_SY_ARG_OUT_OF_DOMAIN`.
- The `p` that `abs( )` makes of a **text** is expected to have the decimals of the number as written, trailing zeros
  included, and these decide how a text on the other side is rounded: `abs( c_'-1.25' ) = '1.2504'` is true,
  `abs( c_'-1.250' ) = '1.254'` is false. It holds 31 digits, the digits before the point counting as at least one:
  decimals beyond that are rounded off, and more than 31 digits before the point raise `CX_SY_CONVERSION_OVERFLOW`.
  A `p` has at most 14 decimals, so a number that keeps more ends the program with the runtime error
  `SYSTEM_TYPE_NOT_ELEMENTARY`, also when its value is 0.
- The operands are evaluated from left to right, both before they are compared, and only when their relational
  expression is (see *Logical expressions*): with `x` below the lower bound, the function in the upper bound of
  `BETWEEN` is not called.

**Arithmetic expressions.** `ipow( )`, and `abs( )` or `sqrt( )` of an arithmetic expression or of another function,
are arithmetic expressions: the rules of *Arithmetic expressions as operands* apply, so `ipow( base = i exp = 2 ) =
c` is a syntax error, and `abs( i_min + 0 ) > int8_0` and `abs( abs( i_min ) ) > int8_0` are calculated in `int8`
without an overflow. The same holds for any function when the other side, or another operand of the `BETWEEN`, is an
arithmetic expression: its argument takes part in the calculation type (`abs( i_min ) > int8_0 + 0` is true,
`sqrt( i_2 ) = decfloat34_root_2 + 0` calculates the root in `decfloat34`).

## Syntax errors

Besides the arithmetic cases above, a comparison of two operands whose kinds have no comparison type (the `-` cells
of section 1: `d` with `t`, `utclong` with anything but `c`, `string` and `utclong`) is a syntax error when both
types are known statically. With a generic operand the types are known at run time only, and the comparison ends
the program with the runtime error `COMPARE_NOT_SUPPORTED`.

## Exceptions and runtime errors

| Error | Raised by |
|---|---|
| `CONVT_NO_NUMBER` (runtime error) | a text operand that is not a number in a numeric comparison type |
| `CONVT_OVERFLOW` (runtime error) | a text or `n` operand that does not fit the comparison type `p` (more than 31 digits) |
| `SYSTEM_TYPE_NOT_ELEMENTARY` (runtime error) | `abs( )` of a text whose number needs more than 14 decimals, outside an arithmetic expression |
| `CX_SY_CONVERSION_OVERFLOW` | `abs( )` of a text whose number has more than 31 digits before the point, outside an arithmetic expression |
| `COMPARE_NOT_SUPPORTED` (runtime error) | operands of kinds without a comparison type, known at run time only |
| `CX_SY_CONVERSION_NO_NUMBER` | a text operand of an arithmetic expression that is not a number for its calculation type |
| `CX_SY_ARITHMETIC_OVERFLOW`, `CX_SY_ZERODIVIDE`, … | an arithmetic expression, as in [calculation.md](calculation.md) |

A runtime error cannot be caught with `TRY … CATCH`: in a comparison of data objects a conversion error ends the
program, while the same error in an arithmetic expression is a catchable exception.

## Open points

- **Not covered yet**: the string comparison operators (`CO`, `CN`, `CA`, `NA`, `CS`, `NS`, `CP`, `NP`), the byte
  operators (`BYTE-CO`, …, `O`, `Z`, `M`), the predicate expressions (`IS INITIAL`, `IS ASSIGNED`, `IS BOUND`,
  `IS SUPPLIED`, `IN` with a ranges table), comparisons of string and bit expressions, enumerated types, structures
  and internal tables, reference variables, and the places that compare without an `IF`: `READ TABLE … WITH KEY`,
  table keys, `SORT` (with `AS TEXT`), `DELETE ADJACENT DUPLICATES`, `COLLECT`.
- **Values the grid has no cells for**: `c` with lengths beyond 40, `p` with more than 3 decimals against text, and
  `d`/`t` against `n` lengths other than 4, 6, 8 and 10 follow the rules above by construction, without cells.
