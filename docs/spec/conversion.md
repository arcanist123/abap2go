# Conversion rules for elementary data objects

The conversion table of the rule-table specification ([roadmap.md](../roadmap.md), critical path): what `=`,
`MOVE`, parameter passing and every other implicit conversion do between two elementary types, including the
exception raised. The structure follows the ABAP keyword documentation, *Conversion Rules for Elementary Data
Objects* (sections *Numeric Source Fields*, *Character-Like Source Fields*, *Byte-Like Source Fields*, *Date Fields
and Time Fields*, *Time Stamp Fields*); the details below go further than the documentation where it is silent
(sign placement, padding, which text counts as a number).

**Status (2026-11-24): all 16 × 16 cells are specified and implemented** in the Go runtime,
[`runtime/go/abap/conv.go`](../../runtime/go/abap/conv.go), one implementation per cell for static and generic
operands (`abap.Convert`). The test cases are
[`testdata/conversion.tsv`](../../runtime/go/abap/testdata/conversion.tsv) (7,427 cells, chosen at the edges of
each rule), [`testdata/conversion_random.tsv`](../../runtime/go/abap/testdata/conversion_random.tsv) (4,275
cells from random values), [`testdata/conversion_edges.tsv`](../../runtime/go/abap/testdata/conversion_edges.tsv)
(2,102 cells at and beyond the ranges of the integer, p and n targets) and
[`testdata/conversion_target.tsv`](../../runtime/go/abap/testdata/conversion_target.tsv) (2,217 cells: what the
target holds after an exception, see the section of that name); `go test ./abap/` runs them all. A test case is a
snippet: the line

```
p8.2	[1.5]	c3	[*50]
```

stands for `DATA src TYPE p LENGTH 8 DECIMALS 2 VALUE '1.5'. DATA dst TYPE c LENGTH 3. dst = src.` with `*50` as
the expected content of `dst`. The header of `conversion.tsv` explains the format.

## The matrix

Rows are the source, columns the target. Each cell names the rule; the rules are defined per source below.
`d16`/`d34` are decfloat16 and decfloat34, `utcl` is utclong.

| from \ to | c | n | d | t | string | x | xstring | i, int8, b, s | p | f | d16, d34 | utcl |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **c** | copy | digits | copy | copy0 | trim | hex | hex | number | number | float | number+E | stamp |
| **string** | copy | digits | copy* | copy0 | = | hex | hex | number | number | float | number+E | stamp |
| **n** | copy | right | copy | copy0 | trim | via i | via i | number | number | float | number+E | NS |
| **d** | copy | copy0 | = | **RT** | trim | days | days | days | days | days | days | NS |
| **t** | copy | copy0 | **RT** | = | trim | secs | secs | secs | secs | secs | secs | NS |
| **x** | hexdig | via i | via i | via i | hexdig | bytes | = | int | via i | via i | via i | NS |
| **xstring** | hexdig | via i | via i | via i | hexdig | bytes | = | int | via i | via i | via i | NS |
| **i, b, s** | sign | abs | date | time | sign | two's | two's | range | round | exact | exact | NS |
| **int8** | sign | abs | date | time | sign | two's | two's | range | round | nearest | exact | NS |
| **p** | sign | abs | via i | via i | sign | via i | via i | round | round | nearest | exact | NS |
| **f** | sci | abs17 | via i | via i | sci17 | via i | via i | round17 | round17 | = | 17 / 16 | NS |
| **d16, d34** | fit | abs! | via i | via i | ieee | via i | via i | round | round | nearest | round | NS |
| **utcl** | stamp | NS | NS | NS | stamp | NS | NS | NS | NS | NS | NS | = |

**NS**: not supported, `CX_SY_CONVERSION_NOT_SUPPORTED` (a syntax error with static types, a catchable exception
with generic ones). **RT**: the runtime error `MOVE_NOT_SUPPORTED`, which cannot be caught.

Throughout, **rounding** is half away from zero (commercial rounding), **overflow** is `CX_SY_CONVERSION_OVERFLOW`,
and a text that is not a number is `CX_SY_CONVERSION_NO_NUMBER`. "Via i" means the source is first converted to an
`i` value (rounded; an overflow if it is out of the range of `i`, even where the target could hold it) and then
follows the rule of an `i` source.

## Character-like sources: c and string

A `c` source includes its trailing blanks where it is copied; a `string` has no length beyond its content.

| Target | Rule |
|---|---|
| c | **copy**: left-aligned, cut on the right or padded with blanks |
| n | **digits**: only the digits 0-9 are kept, right-aligned, zeros in front, cut on the left (`a1b2c3` → n4 `0123`, `12-` → `0012`) |
| d | **copy** as for c LENGTH 8, no check of the date. **copy\***: an empty string gives `00000000`, a string of blanks gives blanks |
| t | **copy0**: left-aligned, cut on the right, padded with **zeros** (`12 ` → `12 000`) |
| string | **trim**: a `c` loses its trailing blanks |
| x | **hex**: the leading hexadecimal digits, **upper case only** (0-9, A-F), up to the first other character (a blank included); an odd last digit is completed with 0; then left-aligned, padded with 00 bytes (`0A1g` → `0A10`, ` 12` → `00`) |
| xstring | **hex** as for x, as many bytes as the digits make (`1E2` → `1E20`) |
| i, int8, b, s, p | **number**, see below; rounded to the target's decimals, an overflow if it does not fit |
| decfloat16/34 | **number+E**: as *number*, or a number with an exponent; rounded to 16 or 34 digits, see decfloat targets |
| f | **float**, see below |
| utclong | **stamp**, see below |

**number** (targets i, int8, b, s, p, decfloat): blanks around the number are ignored; a blank text is 0. The
number is digits with at most one decimal point and at least one digit (`.5` and `5.` are numbers, `.` is not). A
sign stands either in front, optionally followed by blanks (`- 3` is -3), or at the end, optionally preceded by
blanks (`7 -` is -7), never both (`+-1`, `-1-` are not numbers). No exponent (`1E2` is not a number), no other
characters (`1,5`, `1 2`, `0x10` are not numbers).

**number+E** (decfloat targets) also accepts mantissa, `E` or `e`, an optional exponent sign and digits, as one
token: `-1.5E+2`, `1e2` are numbers, while `- 1E2` (blank after the sign), `1E2-` (sign at the end) and `1.5 E2` are
not.

**float** (target f) follows its own rules, those of C's `strtod` with a sign at the end:
- trailing blanks are ignored, a blank text is 0;
- a text that starts with a blank: the longest number after the blanks is taken, and what follows it must start
  with a blank; if there is no number at all, the value is 0 (` + 7` is 0, ` 7-` is not a number);
- otherwise the text must start with a number. It may be followed directly by a sign (`12-`, `1E-2-`; not when the
  number already has one: `-1-` is not a number), or by blanks, after which anything is ignored (`1 2` is 1, `7 -`
  is 7, `1.5 E2` is 1.5); anything else right after the number is an error (`1-2`, `1.5E2.5`, `1E 2`);
- a number is an optional sign, digits with an optional point, and an optional exponent `E`/`e` with digits
  (`1E` alone is not a number); `INF`, `INFINITY` and `NAN` in any case are read and are an overflow, as is a value
  beyond the range of f; a value below it becomes 0, a subnormal value is kept;
- the text `-0` gives +0.

**stamp** (target utclong): `YYYY-MM-DD`, a blank or `T` (upper case), `hh:mm:ss`, optionally a point or comma and 0
to 7 digits of fraction, then only blanks. A blank text is the initial value. `24:00:00` is the next day; seconds
60 and minutes 60 are errors, as are leading blanks, `Z`, a fraction of 8 digits and a five-digit year. The date
follows the calendar described under d below, except that the ten days 1582-10-05 to 1582-10-14 are refused. The
exception is `CX_SY_CONVERSION_NO_DATE_TIME`.

## n

| Target | Rule |
|---|---|
| c, d | **copy** as for a c source |
| t | **copy0** |
| n | **right**: right-aligned, zeros in front, cut on the left, without checking the characters |
| string | **trim** |
| x, xstring | **via i**: read as a number (rules of c), then as an i source |
| numbers, f | read with the rules of a c source (an n field holding `12A4` is not a number) |

## d and t

| Target | Rule |
|---|---|
| c | **copy** |
| n | **copy0**: left-aligned, cut on the right, padded with zeros (d `20240229` → n10 `2024022900`) |
| string | **trim** |
| t (from d), d (from t) | **RT**: the runtime error `MOVE_NOT_SUPPORTED` |
| all numeric targets, x, xstring | **days** / **secs**: the day number or the number of seconds, then as an i source |

**Day number**: days since 0001-01-01 (day 0) on ABAP's calendar, which is Gregorian from 1582-10-15 and
Julian before it: the day number is the Julian Day Number minus 1721424. 1500-02-29 is valid (Julian leap year),
1700-02-29 is not; 1582-10-04 is day 577736 and 1582-10-15 day 577737; the ten skipped days 1582-10-05 to -14 are
read as Julian dates (1582-10-05 is also day 577737). A d value that is not a valid date (not eight digits,
month 13, year 0000, blanks) gives 0.

**Seconds**: hh·3600 + mm·60 + ss without range checks (`246060` gives 90060); a t value that is not six digits
gives 0.

## x and xstring

| Target | Rule |
|---|---|
| c, string | **hexdig**: two upper-case hexadecimal digits per byte; for c left-aligned, cut or padded with blanks |
| x | **bytes**: left-aligned, cut on the right, padded with 00 bytes |
| xstring | copied |
| int8 | **int**: the last 8 bytes (00 bytes added in front if shorter) as a signed integer (x4 `FFFFFFFF` → 4294967295) |
| all other targets | **via i**: the last 4 bytes (00 bytes in front if shorter) as a signed i (x2 `FFFF` → 65535, x4 `FFFFFFFF` → -1) |

## Integer sources: i, int8, b, s

| Target | Rule |
|---|---|
| c | **sign**: the digits followed by the sign character, `-` or a blank, right-aligned (`7` → c3 ` 7 `). A positive number drops its blank if that makes it fit (`255` → c3 `255`). If it does not fit, the first character is `*` and the rest is the end of the number (`32768` → c3 `*68`, `-129` → `*9-`) |
| string | **sign**: the digits and the sign character, so a positive number ends in a blank (`7 `, `7-`) |
| n | **abs**: the absolute value, right-aligned, zeros in front, cut on the left without an error |
| d | **date**: the date of that day number for 1 to 3652060 (9999-12-31), else `00000000`. An int8 counts with its lower four bytes as an i: 2^32 + 738000 is expected to give `20210728`, 2^63 - 1 (lower bytes -1) `00000000` |
| t | **time**: the time of day of that number of seconds, modulo 86400 (`-1` → `235959`); an int8 with its whole value (2^32 → `062816`) |
| x | **two's**: the two's complement, 4 bytes (int8: 8 bytes; b and s count as i), big-endian, right-aligned: cut on the left, or padded with **00** bytes in front without sign extension (i `-7` → x10 `000000000000FFFFFFF9`) |
| xstring | **two's**: 4 bytes (int8: 8) without leading 00 bytes, at least one byte (`255` → `FF`, `0` → `00`, `-7` → `FFFFFFF9`) |
| i, int8, b, s | **range**: an overflow outside the target's range (b: 0 to 255, s: -32768 to 32767) |
| p | **round**: an overflow if the digits do not fit |
| f | exact for i, b, s; **nearest** (round to nearest even) for int8 |
| decfloat | exact, exponent 0 (b `200` → `200`, i `100000` keeps its six digits) |

## p

| Target | Rule |
|---|---|
| c | **sign**: as for integers, with the decimal point and all decimals (`1.50 `, `1.50-`). Before using `*`, a number below 1 drops its leading 0 (p8.2 `0` → c3 `.00`, `-0.5` → p3.1 in c3 `.5-`) |
| string | **sign**: `1.50 `, `1.50-` |
| n | **abs**: rounded to an integer, then as for integers (cut on the left, no error) |
| d, t, x, xstring | **via i** |
| i, int8, b, s, p | **round** to the target's decimals; an overflow if it does not fit |
| f | **nearest**: the binary floating-point number nearest to the exact value |
| decfloat | exact with its scale (p8.2 `1.5` → `1.50`, `0` → `0.00`), rounded to 16 or 34 digits if longer |

## f

f values become decimal numbers through their **17-significant-digit** decimal form, not their exact binary value:
2^63 rounds to `9223372036854775800`, `1.005` (binary 1.00499999999999989…) is `1.0049999999999999`.

| Target | Rule |
|---|---|
| c | **sci**: scientific notation, right-aligned, with a place for the sign (blank or `-`), the mantissa with as many decimals as fit (at most 16) and an exponent of at least two digits: c10 ` 1.000E+00`, `-1.000E+00`, ` 1.00E+300`. A positive number may use the sign's place for a mantissa without decimals (c5 `2E+00`); if even that does not fit, the field is filled with `*`. The mantissa is rounded from the exact value. Zero is `0.000E+00` without a sign |
| string | **sci17**: `1.0000000000000001E-01`, `-2.5000000000000000E+00`; zero without a sign |
| n | **abs17**: the 17-digit form rounded to an integer, absolute, cut on the left |
| d, t, x, xstring | **via i** |
| i, b, s, p | **round17**: the 17-digit form rounded to the target's decimals (p3.1: `0.15` → `0.1`, `0.25` → `0.3`) |
| int8 | **round17**, and an overflow if the exact value is out of range (2^63 is an overflow) |
| decfloat34 | **17**: the 17-digit form without trailing zeros (`0.1` → `0.10000000000000001`, `1.5` → `1.5`) |
| decfloat16 | **16**: the 16-digit form without trailing zeros (`0.1` → `0.1`) |

## decfloat16 and decfloat34

Values keep their scale (`1.0` and `1.00` differ) and a signed zero.

| Target | Rule |
|---|---|
| string | **ieee**: the IEEE 754 scientific string: plain notation when the exponent is at most 0 and the adjusted exponent at least -6, else `d.dddE+n` (`1.00`, `1E+3`, `1000`, `0.000001`, `1E-7`, `-0.0`, `1E+100`) |
| c | **fit**: the string form right-aligned if it fits. Otherwise the better of two: the plain notation rounded to fewer decimals (never rounding a value other than zero to zero) and the scientific notation with as many mantissa digits as fit (exponent without leading zeros: `1.2346E+15`); the one keeping more significant digits wins, the plain notation on a tie (`123.456` → c5 `123.5`, `-0.000001234` → c9 `-1.234E-6`, `1234567890` → c6 `1.2E+9`); an overflow if neither fits |
| n | **abs!**: rounded to an integer, absolute; an **overflow** if the digits do not fit (unlike every other source) |
| d, t, x, xstring | **via i** |
| i, int8, b, s, p | **round** to the target's decimals; an overflow if it does not fit |
| f | **nearest**; an overflow beyond the range of f, 0 below it; -0 stays -0 |
| decfloat | **round**, see below |

**Rounding to a decfloat target** (from text, p, int8, f, decfloat34): to 16 or 34 significant digits, half away
from zero. The exponent of the last digit is limited to -398..369 (decfloat16) or -6176..6111 (decfloat34): a value
needing a larger exponent gets its coefficient padded with zeros if it has room (`1E+6144` becomes 34 digits with
exponent 6111), else it is an overflow; a smaller exponent rounds the value to the smallest unit, possibly to 0
(`1E-400` → decfloat16 `0E-398`, `5E-399` → `1E-398`).

## utclong

| Target | Rule |
|---|---|
| c | **stamp**: `YYYY-MM-DD hh:mm:ss.fffffff`, left-aligned, cut or padded; blanks for the initial value |
| string | **stamp**, the empty string for the initial value |
| utclong | copied |
| all others | **NS** |

## The target after an exception

A conversion that raises `CX_SY_CONVERSION_OVERFLOW` or `CX_SY_CONVERSION_NO_NUMBER` does not always leave its
target as it was: ABAP is expected to write a value into some targets before the exception is raised, and a
`CATCH` (or a `CLEANUP`) sees that value. The keyword documentation does not say what the target holds; the rules
below are worked out cell by cell, for static and generic operands alike (the cells are in
[`testdata/conversion_target.tsv`](../../runtime/go/abap/testdata/conversion_target.tsv)). Every case not listed
keeps the target, as do the other exceptions (`CX_SY_CONVERSION_NOT_SUPPORTED`, `CX_SY_CONVERSION_NO_DATE_TIME`,
`CX_SY_CONVERSION_ROUNDING`).

| Source | Target | Left in the target |
|---|---|---|
| i, int8, b, s, d, t, x, xstring | b, s | the **lower byte** (b) or **lower two bytes** (s) of the integer, two's complement: i `300` → b `44`, i `-1` → b `255`, i `40000` → s `-25536`; d and t count with their day or second number, x and xstring with the i of their last four bytes |
| int8 | i | the **lower four bytes**: `3000000000` → `-1294967296`, `4294967297` → `1` |
| p, n | b, s | the value rounded to an i, then its lower bytes as above (p `300.5` → b `45`, n `0000040000` → s `-25536`); a value beyond i keeps the target |
| f | b, s | the 17-digit form rounded to an i, then its lower bytes; a value beyond i becomes -2^31, so the target is left with `0` (f `123456.789` → s `-7615`, `1E10` → b `0`) |
| c, string | i, int8, b, s | **not a number**: `0`. **Too large**: the sign of the number, `1` or `-1` (b: `255`): c `300` → b `1`, c `-40000` → s `-1` |
| c, string | p | `0`, whether not a number or too large |
| c, string, n | f | **not a number**: the longest number at the start of the text as the *float* rule reads it (after leading blanks, with its sign, `.5` and `5.` included, an exponent only if it has digits), `0` if there is none: `12abc34` → `12`, `1.5E2.5` → `150`, `1E+x` → `1`, `1,5` → `1`, `- 12x` → `0`; a number below the range of f gives `0`. **Overflow**: `+Inf` or `-Inf` (`1E400`, `-INF`, `Infinity`, and a number prefix out of range such as `1E999x`, which is an overflow rather than not a number), the quiet NaN `7FF8000000000000` for `NAN` |
| decfloat16, decfloat34 | f | `+Inf` or `-Inf` |
| decfloat16, decfloat34 | n | the **absolute value as a c field of the same length would show it** (the *fit* rule), if it fits: `12345.678` → n4 `1E+4`, `-1E100` → n10 `    1E+100`, `1234567890123456` → n10 `1.2346E+15`; otherwise the target is kept (`1E+100` in n4) |
| decfloat34 | decfloat16 | `+Infinity` or `-Infinity` (see *Known gaps*) |

Kept, by contrast: p targets from every source but text; i and int8 targets from p, f, n and decfloat; b and s
targets from decfloat; d, t, x and xstring targets (the *via i* overflow); c targets of decfloat; decfloat targets
from text. An `n` source keeps an integer or p target when it is not a number, unlike c and string.

In arithmetic the same rules apply when the result is moved into the result field: `b += 300` from 5 leaves `49`,
a p calculation `b = i_300 + p_0` raises `CX_SY_ARITHMETIC_OVERFLOW` and leaves `44`. An exception in the
calculation itself, and every exception under `EXACT`, keeps the result field (see
[calculation.md](calculation.md)).

## Known gaps

- **b and s** are implemented, but the compiler cannot declare them yet: abaplint does not type them, so a
  declaration with a DDIC type such as INT1 or INT2 is a build error for now.
- The compiler uses the cells for `=` between variables and literals, `VALUE` and `out->write( )`. Other places
  that convert (parameter passing, `MOVE-CORRESPONDING`, table keys, string templates) follow as those statements
  are compiled; they call the same `abap.Convert`.
- **Special values after an exception.** An f target can be left holding `+Inf`, `-Inf` or NaN and a decfloat16
  target `+Infinity` or `-Infinity` (see *The target after an exception*). The runtime holds the f values, but what
  `WRITE`, the conversions, comparisons and arithmetic do with them is not specified yet; it keeps a decfloat16
  target instead of storing an infinity, which has no representation in its decfloat value yet. This stand-in is
  not observable only because `TRY` is not compiled (next point): an exception ends the program before anything
  can read the target. Once a `CATCH` can read it, a kept target would be a silently different result, so the gap
  has to be closed before `TRY` is compiled. Closing it means a decfloat value that holds an infinity and specified
  behaviour for `+Inf`, `-Inf` and NaN. If `TRY` has to come first, the stand-in becomes a run-time error naming
  the gap, listed as an exception to the guiding principle.
- The compiler cannot catch exceptions yet (`TRY` is not compiled), so a value left in a target cannot be seen
  by a program: an uncaught exception ends it. `abap.Convert` and `abap.Calculate` return the value with the
  exception, for the generated code to write once `TRY` is compiled.
- Speed: the cell is chosen at run time, also for static operands, and every numeric cell goes through exact
  decimal arithmetic (`math/big`) for now. Static operands get their cell chosen at build time once `ASSERT` and
  control flow are compiled ([aot_for_abap.md](../aot_for_abap.md), "Static operands: the cell is chosen at build
  time, after control flow is compiled"); both paths must pass the same test cases.
