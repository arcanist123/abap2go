# Comparisons and logical expressions

The comparison table of the rule-table specification ([compiler_roadmap.md](../compiler_roadmap.md), critical path):
which *comparison type* two operands are compared in, how each comparison type compares, what happens when an operand
cannot be converted, how arithmetic expressions take part, how relational expressions combine into logical
expressions, and what the predicate expression `IS INITIAL`, the tabular operator `IN` and the string, byte and bit
operators do. The structure follows the ABAP keyword documentation, *rel_exp - Comparison Type of Elementary Data
Objects* (and its pages per kind), *rel_exp - Comparison Rules for Comparison Types*, *rel_exp - Comparison Type of
Arithmetic Expressions*, *log_exp - Boolean Operators and Parentheses*, *rel_exp - IS INITIAL*, *rel_exp - Comparison
Operators for Character-Like Data Types*, *… for Byte-Like Data Types*, *… for Bit Patterns* and *rel_exp - Tabular
Comparison Operator IN*; the details below go further than the documentation where it is silent (rounding of a text
compared with an integer, which conversion errors end the program, length adjustments, short-circuit evaluation,
`CP` patterns, the order in which the rows of a ranges table are evaluated).

**Predicates and operators (2026-11-27): specified, not implemented yet** (the section *Predicate expressions and
comparison operators*). Their test cases are
[`testdata/comparison_predicate.tsv`](../../runtime/go/abap/testdata/comparison_predicate.tsv) (1,703 cells),
[`testdata/comparison_in.tsv`](../../runtime/go/abap/testdata/comparison_in.tsv) (596 cells), 3,841 and 938 random
cells held out while the rules were worked out
([`comparison_predicate_random.tsv`](../../runtime/go/abap/testdata/comparison_predicate_random.tsv),
[`comparison_in_random.tsv`](../../runtime/go/abap/testdata/comparison_in_random.tsv)), 114 logical expressions with
static types ([`comparison_predicate_expr.tsv`](../../runtime/go/abap/testdata/comparison_predicate_expr.tsv)) and
the case mapping ([`case_upper.tsv`](../../runtime/go/abap/testdata/case_upper.tsv)).

**Comparisons (2026-11-26): specified; the comparison of two data objects is implemented in the runtime**
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
with the same results as the same types written statically; only two cases behave differently: a pair without a
comparison type (a runtime error instead of a syntax error) and an `f` NaN compared with an `f`
([special_values.md](special_values.md), which also has the rules for infinities and NaN).

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

**Parentheses around a single data object** are expected to change nothing: they do not make an arithmetic
expression, so `( c ) = c2` compares two `c` as text and `( c ) = i` follows the rules of two data objects. The same
holds for an assignment, `n = ( c ).`.

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
a `string`, a number literal an `i`, or a `p` without decimals if it is beyond the range of `i`: `p LENGTH 8` for up
to 15 digits (leading zeros not counted), `p LENGTH 16` for up to 31 (`int8_max < 18446744073709551615` is true,
compared in `p`; `i_max < 3000000000` is true). A negative number literal (`-1`) is a number, so `-1 = '1-'` is
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

## CASE

`CASE operand. WHEN value1 OR value2. …` compares by `operand = value1 OR operand = value2 …`, with the rules of two
data objects (sections 1 to 4). The test cases are
[`test/case_do.test.ts`](../../test/case_do.test.ts).

**Evaluation.** The operand is evaluated first, once, also when no `WHEN` compares it: `CASE 1 / z.` with `WHEN
OTHERS` alone raises `CX_SY_ZERODIVIDE` for `z = 0`, and so does a subfield out of its bounds raise its exception.
The values are then evaluated from top to bottom and from left to right, up to the first that equals the operand.

**Statements before the first `WHEN`.** In a program outside classes, statements between `CASE` and the first `WHEN`,
and a `CASE` without `WHEN`, are expected to give only a warning (in classes they are syntax errors). The statements
run after the operand is evaluated and before the first value is compared. When they change what the operand was taken
from, the comparisons see:

| Operand | Compared with |
|---|---|
| a variable | its content after the statements |
| a subfield of a `c`, `n`, `d`, `t` or `x` field | the content after the statements, at the offset and length evaluated before them |
| a subfield of a `string` or `xstring` | the value before the statements |
| a built-in function or an arithmetic expression | the value before the statements |

An exception of the operand, such as a subfield out of its bounds, is raised before any of these statements runs.

**The operand** is a general expression position:

- a data object, or a built-in function of a single data object, which is a value as in *Built-in functions as
  operands* (`CASE abs( c_'-1.250' )` has three decimals);
- an arithmetic expression, calculated in the calculation type of **its own operands**: the values after `WHEN` take
  no part, unlike the other side of a comparison. With `a = 1` and `b = 3`, `CASE a / b * b.` is 0 in `i`, also
  against a `decfloat34` value, while `IF a / b * b = decfloat34_1` calculates in `decfloat34`. The result is a data
  object of the calculation type, so a text value is converted by the rules of that comparison type, and a text that
  is no number ends the program with `CONVT_NO_NUMBER`.

ABAP is expected to reject parentheses around a single operand (`CASE ( a ).`) as a syntax error, but not around a
calculation (`CASE ( - a ).`).

**A `p` result** is expected to have the decimals it would have in a `string` ([calculation.md](calculation.md),
section 4): at most 14, and at most 31 digits in all, with the scale of the operations that made it. They decide how
a text value is rounded: `p_3 * p_2` has one decimal, so it equals `'6.04'`, while `p_3 + p_3` has none and equals
`'6.4'`. More than 31 digits before the point raise `CX_SY_ARITHMETIC_OVERFLOW`.

**The values** after `WHEN` are extended functional operand positions: a data object, or `abs( )`, `sqrt( )` or
`strlen( )` of a single data object. An arithmetic expression there, `ipow( )` among them, is a syntax error.

## Predicate expressions and comparison operators

The comparison types of section 1 do **not** apply to the string, byte and bit operators: nothing is converted, the
operands must be of the kinds the operator works on. `IN` compares by the rules of section 1.

### IS INITIAL

`a IS INITIAL` is true if `a` holds the initial value of its type, `a IS NOT INITIAL` and `NOT a IS INITIAL` if it
does not.

| Type | Initial value | Not initial, for example |
|---|---|---|
| `i`, `int8`, `b`, `s`, `p` | 0 | |
| `f`, `decfloat16`, `decfloat34` | a zero of any sign and exponent (`-0`, `0.00`, `0E+100`) | the smallest value above 0; every special value ([special_values.md](special_values.md)) |
| `c` | blanks only | |
| `n`, `d`, `t` | zeros only | a field of blanks, a `0` followed by blanks |
| `string` | length 0 | a string holding a blank |
| `x` | bytes 00 only | |
| `xstring` | length 0 | an `xstring` holding one byte 00 |
| `utclong` | the initial value | `0001-01-01 00:00:00` |

**The operand** is an extended functional operand position: a data object, a subfield, a literal, a built-in function
such as `abs`, `sign`, `ceil`, `floor`, `trunc`, `frac`, `sqrt`, `exp`, `strlen`, `xstrlen`, `numofchar`, `lines`,
`utclong_current` or `dbmaxlen` of a data object, a constructor expression such as `CONV` or `COND`, or a table
expression. Syntax errors are an arithmetic expression (`- a`, `a + 0`, `ipow( )`, `nmax( )`, `abs( a + 0 )`), a
string function (`to_upper( )`, `substring( )`, `condense( )`), `boolc( )`, `xsdbool( )`, a string or bit expression
and a string template.

### The operators for character-like operands

`CO`, `CN`, `CA`, `NA`, `CS`, `NS`, `CP`, `NP` take operands of the types `c`, `n`, `d`, `t` and `string`, and flat
structures with character-like components only. Anything else is a syntax error (`i CO c`, `5 CS c`); behind a
generic operand it is the runtime error `UC_OBJECTS_NOT_CHARLIKE`. Data objects, literals, string expressions,
string functions and a `CONV` to a character-like type can be operands, arithmetic expressions cannot.

The operators work on UTF-16 code units, so two characters outside the Basic Multilingual Plane that share a
surrogate share a code unit (`CA` finds it). Which trailing blanks take part:

| Operators | Left operand | Right operand |
|---|---|---|
| `CO`, `CN`, `CA`, `NA` | all code units | all code units |
| `CS`, `NS` | all code units | `c`, `n`, `d`, `t` without their trailing blanks; a `string` as it is |
| `CP`, `NP` | see below | see below |

- **`CO`** is true if every code unit of the left operand occurs in the right one, case counting. An empty left
  operand gives true, also against an empty right one. `sy-fdpos` is the offset of the first code unit that does not
  occur, or the length of the left operand. **`CN`** is its negation.
- **`CA`** is true if some code unit of the left operand occurs in the right one, so an empty operand gives false.
  `sy-fdpos` is the offset of the first one that occurs, or the length of the left operand. **`NA`** is its negation.
- **`CS`** is true if the right operand occurs in the left one, ignoring case (below); an empty right operand occurs
  at offset 0 in any left operand. `sy-fdpos` is the offset of the first occurrence, or the length of the left
  operand. **`NS`** is its negation.
- **`CP`** is true if the left operand as a whole matches the pattern in the right one; **`NP`** is its negation.

These rules give the special cases the keyword documentation states for empty operands, with one difference for
`CS`: a `c` on the left is searched with all its blanks, so `` c1 ' ' CS ` ` `` is true.

**Patterns.** `*` stands for any sequence of code units, also none, `+` for exactly one code unit, and `#` makes the
code unit behind it stand for itself, case counting. Every other code unit matches ignoring case, a blank among them.

- A `string` pattern is taken as it is. A pattern of type `c`, `n`, `d` or `t` loses its trailing blanks, except one
  that a `#` precedes; if it holds blanks only, it is a single blank.
- A `string` on the left must be matched to its end. In a `c`, `n`, `d` or `t` on the left, blanks may remain behind
  what the pattern matched: `c4 'ab'` matches `ab`, `ab+` and `ab++`, but not `ab+++`.
- The empty pattern (only a `string` can be one) matches an empty left operand only.
- An empty left operand matched against a pattern that starts with `*` and holds something else than `*` is matched
  like a single blank: `` `` CP `*+` `` is true, `` `` CP `+` `` and `` `` CP `*a` `` are false.
- `sy-fdpos` of a match is 0 if the pattern does not start with `*`, or consists of `*` only. Otherwise it is the
  smallest offset at which the pattern without its leading `*` matches the rest of the left operand:
  `` `abc` CP `*+` `` gives 2, `c5 'xabcx' CP '*+*'` gives 0. Without a match it is the length of the left operand.

**Case.** `CS`, `NS`, `CP` and `NP` take two code units as equal if
[`case_upper.tsv`](../../runtime/go/abap/testdata/case_upper.tsv) maps them to the same upper case: `σ`, `ς` and `Σ`
are equal, and so are `i`, `I` and the dotless `ı`, but not the dotted `İ`. Surrogates have no mapping, so case
counts outside the Basic Multilingual Plane.

### The operators for byte-like operands

`BYTE-CO`, `BYTE-CN`, `BYTE-CA`, `BYTE-NA`, `BYTE-CS`, `BYTE-NS` take operands of the types `x` and `xstring`, and
work as `CO`, `CN`, `CA`, `NA`, `CS`, `NS` do, on whole bytes and without a case mapping: trailing bytes 00 count,
and `x2 'A1B2'` does not contain the byte `1B`. `sy-fdpos` counts bytes. A text literal, a number literal or a
structure as an operand is a syntax error; behind a generic operand a type that is not byte-like is the runtime error
`OBJECTS_NOT_BYTELIKE`. Bit expressions can be operands.

### The operators for bit patterns

`a O b`, `a Z b` and `a M b` compare the bytes of `a` with the bit pattern `b`, both `x` or `xstring`. The bytes are
aligned on the left; where `a` is shorter, its missing bytes count as 00, and bytes of `a` beyond the end of `b` do
not matter. Of the bits that are 1 in `b`, `O` asks whether all are 1 in `a`, `Z` whether all are 0, and `M` whether
at least one is 1 and one is 0. A pattern without a 1, an empty one among them, gives true for `O` and `Z` and false
for `M`. `sy-fdpos` is not set. A text or number literal as an operand is a syntax error here too. Behind generic
operands, a left operand that is not byte-like is the runtime error `OBJECTS_NOT_BYTELIKE`, a right one
`BITS_WRONG_TYPE`.

### IN

`a IN r`, and `a NOT IN r` as its negation, check `a` against the rows of a ranges table.

**The table** is an internal table of any kind whose line has four components, with any names: a `c LENGTH 1` (the
sign), a `c LENGTH 2` (the option) and two of one type (low and high). Anything else is a syntax error. A table with
a header line stands for its body.

**The operand** is a general expression position, treated like the operand of `CASE`: an arithmetic expression is
calculated in the calculation type of its own operands, without low and high, so with `i = 7`, `i / 2 IN r` is true
for a row `I EQ 4` and false for `I EQ 3.5`, whatever their type. With a ranges table of a character-like low, an
arithmetic operand is a syntax error. The operand is evaluated once, also when the table is empty (`1 / z IN r`
raises `CX_SY_ZERODIVIDE` for `z = 0`).

**An empty table** gives true for an operand of any type.

**The rows are evaluated in the order of the table**, each as follows:

1. A sign other than `I` or `E` ends the program with the runtime error `CHECK_SELOPT_ILLEGAL_SIGN`.
2. A row with sign `I` is skipped if an earlier row with sign `I` was true: its option is not looked at and nothing is
   converted.
3. An option other than `EQ`, `NE`, `GT`, `GE`, `LT`, `LE`, `BT`, `NB`, `CP`, `NP`, in upper case, ends the program
   with the runtime error `CHECK_SELOPT_ILLEGAL_OPTION`.
4. The row's comparison is evaluated:
   - `EQ` to `LE`: `a = low` and so on, by the rules of two data objects (sections 1 to 4); high is not used;
   - `BT`: `a BETWEEN low AND high`, so high is not converted when `a` is below low; `NB` is its negation. With low
     above high, `BT` is false for every value;
   - `CP`, `NP`: the operators above, with the pattern below.
5. A true row with sign `E` makes the expression false; no further row is looked at.

If no `E` row was true, the expression is true if an `I` row was true or the table has no `I` row. The value is that
of the keyword documentation's *(the `I` rows joined by `OR`) AND NOT (the `E` rows joined by `OR`)*, but the order of
evaluation follows the table, which decides what is raised: with rows `E EQ 5`, `I EQ 'abc'` the number 5 gives false
without an error, with the two rows swapped the program ends with `CONVT_NO_NUMBER`.

**The pattern of `CP` and `NP`.** With low and high of type `c`, `n`, `d` or `t`, the pattern is low in its full length
followed by high in its full length, and then treated as a pattern of that kind: the `c4` values `ab` and `*` give
`ab  *`, and the initial high of a `d` adds its zeros. With low and high of type `string`, the pattern is low alone and
high is not used. (The keyword documentation describes `low && high`.) The operand and low must be character-like,
otherwise the program ends with `UC_OBJECTS_NOT_CHARLIKE`.

A comparison that is not possible ends the program as it does between two generic operands (`COMPARE_NOT_SUPPORTED`,
`CONVT_NO_NUMBER`, …).

### sy-fdpos

The string and byte operators set `sy-fdpos` each time they are evaluated, whatever their result, also under `NOT`;
`IN` leaves the value of the last `CP` or `NP` row it evaluated. The other relational expressions, `O`, `Z`, `M` and
an `IN` without such a row leave it unchanged. A relational expression that short-circuit evaluation skips does not
set it.

## Syntax errors

Besides the arithmetic cases above, a comparison of two operands whose kinds have no comparison type (the `-` cells
of section 1: `d` with `t`, `utclong` with anything but `c`, `string` and `utclong`) is a syntax error when both
types are known statically. With a generic operand the types are known at run time only, and the comparison ends
the program with the runtime error `COMPARE_NOT_SUPPORTED`. The syntax errors of predicates and operators are in their
section.

## Exceptions and runtime errors

| Error | Raised by |
|---|---|
| `CONVT_NO_NUMBER` (runtime error) | a text operand that is not a number in a numeric comparison type |
| `CONVT_OVERFLOW` (runtime error) | a text or `n` operand that does not fit the comparison type `p` (more than 31 digits) |
| `SYSTEM_TYPE_NOT_ELEMENTARY` (runtime error) | `abs( )` of a text whose number needs more than 14 decimals, outside an arithmetic expression |
| `CX_SY_CONVERSION_OVERFLOW` | `abs( )` of a text whose number has more than 31 digits before the point, outside an arithmetic expression |
| `COMPARE_NOT_SUPPORTED` (runtime error) | operands of kinds without a comparison type, known at run time only |
| `UC_OBJECTS_NOT_CHARLIKE` (runtime error) | an operand of a string operator, or of a `CP` or `NP` row of `IN`, that is not character-like, known at run time only |
| `OBJECTS_NOT_BYTELIKE` (runtime error) | an operand of a byte operator, or the left operand of `O`, `Z` or `M`, that is not byte-like, known at run time only |
| `BITS_WRONG_TYPE` (runtime error) | a bit pattern of `O`, `Z` or `M` that is not byte-like, known at run time only |
| `CHECK_SELOPT_ILLEGAL_SIGN`, `CHECK_SELOPT_ILLEGAL_OPTION` (runtime errors) | a row of a ranges table with an invalid sign or option |
| `CX_SY_CONVERSION_NO_NUMBER` | a text operand of an arithmetic expression that is not a number for its calculation type |
| `CX_SY_ARITHMETIC_OVERFLOW`, `CX_SY_ZERODIVIDE`, … | an arithmetic expression, as in [calculation.md](calculation.md) |

A runtime error cannot be caught with `TRY … CATCH`: in a comparison of data objects a conversion error ends the
program, while the same error in an arithmetic expression is a catchable exception.

## Open points

- **Not covered yet**: the predicate expressions `IS ASSIGNED`, `IS BOUND`, `IS SUPPLIED` and `IS INSTANCE OF`, the
  predicate functions, comparisons of string and bit expressions, enumerated types, structures (also as operands of
  the string operators) and internal tables (also `IS INITIAL` of them), reference variables, and the places that
  compare without an `IF`: `READ TABLE … WITH KEY`, table keys, `SORT` (with `AS TEXT`),
  `DELETE ADJACENT DUPLICATES`, `COLLECT`.
- **A `#` that escapes nothing**, at the very end of a `CP` pattern (of a `string`, or of a field that it fills to the
  end): usually nothing matches such a pattern, but not always, depending on the types, and no rule is known that
  gives the exceptions. Not specified, no cells. abap2go has to refuse such a literal pattern and to decide what a
  computed one does.
- **A numeric built-in function as the right operand** of a string, byte or bit operator (`c CS strlen( s )`) is
  expected to pass the syntax check and then to behave like the numeric comparison `=` (`<>` for `CN`, `NA`, `NS`,
  `NP`), without setting `sy-fdpos`. Not specified further, no cells; to be refused at build time.
- **Values the grid has no cells for**: `c` with lengths beyond 40, `p` with more than 3 decimals against text, and
  `d`/`t` against `n` lengths other than 4, 6, 8 and 10 follow the rules above by construction, without cells.
