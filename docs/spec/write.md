# WRITE formatting of elementary data objects

The `WRITE` part of the output formatting table of the rule-table specification ([roadmap.md](../roadmap.md),
critical path): the text `WRITE` puts onto a list for a value of each elementary kind, without formatting
additions. String templates (`|{ x }|`) and `DESCRIBE … OUTPUT-LENGTH` are the other parts of the table and are
not covered yet. The structure follows the ABAP keyword documentation, *WRITE - Output Length* and *WRITE -
Predefined Formats*; the details below go further than the documentation where it is silent (which separators
are dropped first, how decfloat rounds when it does not fit).

`WRITE` formatting is not the conversion to text of [conversion.md](conversion.md): `out->write( )` and
`string = x` use the conversion, `WRITE` uses these rules.

**Status (2026-11-24): all 16 kinds are specified and implemented** in the Go runtime,
[`runtime/go/abap/write.go`](../../runtime/go/abap/write.go) (`abap.Format`). The test cases are
[`testdata/write.tsv`](../../runtime/go/abap/testdata/write.tsv) (916 cells: 229 values under four user settings)
and the cases in `write_test.go` for the settings the table does not show; `go test ./abap/` runs them. A test
case is a snippet: the line

```
X2	i	[-1234567]	[ 1,234,567-]
```

stands for a user with decimal notation `X` and date format `2` running
`DATA x TYPE i VALUE -1234567. WRITE x.`, which is expected to output the 11 characters ` 1,234,567-`.

## User settings

The output depends on two settings of the user master record, which abap2go takes from the user setup file (see
below):

| Decimal notation | Example | Decimal separator | Thousands separator |
|---|---|---|---|
| blank (the default) | 1.234.567,89 | `,` | `.` |
| `X` | 1,234,567.89 | `.` | `,` |
| `Y` | 1 234 567,89 | `,` | blank |

| Date format | Example | d (8 characters) | utclong date part |
|---|---|---|---|
| `1` (the default) | DD.MM.YYYY | `DDMMYYYY` | `29.02.2024` |
| `2` | MM/DD/YYYY | `MMDDYYYY` | `02/29/2024` |
| `3` | MM-DD-YYYY | `MMDDYYYY` | `02-29-2024` |
| `4` | YYYY.MM.DD | `YYYYMMDD` | `2024.02.29` |
| `5` | YYYY/MM/DD | `YYYYMMDD` | `2024/02/29` |
| `6` | YYYY-MM-DD | `YYYYMMDD` | `2024-02-29` |

The Japanese, Islamic and Iranian date formats (`7`–`9`, `A`–`C`) and the 12-hour time formats are not supported
yet: a user setup that names them is rejected when the program starts.

## Output length

Every kind has an output length, and `WRITE` always outputs exactly that many characters, trailing blanks
included: they count for the position of the next output (`WRITE 'a '. WRITE 'b'.` gives `a  b`).

| Kind | Output length |
|---|---|
| c, n | the length |
| string | the length of the content (an empty string outputs nothing, but still counts as an output for the gap) |
| x | 2 × the length |
| xstring | 2 × the length of the content |
| d | 8 |
| t | 6 |
| i | 11 |
| int8 | 20 |
| b | 3 |
| s | 6 |
| p | 2 × the length, plus 1 if it has decimals |
| f, decfloat16 | 24 |
| decfloat34 | 46 |
| utclong | 30 |

These are the lengths of the built-in types. A data element from the dictionary has its own output length:
`sy-datum` takes 10 characters and shows the separators of the date format. Dictionary types are not compiled
yet.

## Rules per kind

| Kind | Rule |
|---|---|
| c, n, t, string | **as is**: the content, unchanged (a t is not given separators) |
| x, xstring | **hex**: two upper-case hexadecimal digits per byte |
| d | **reorder**: the eight characters `YYYYMMDD` reordered to the order of the date format, without separators; any content is reordered, valid date or not (`abcdefgh` → `ghefabcd` for format `1`) |
| i, int8, b, s, p | **signed**, see below |
| f | **exponent**: as the conversion to c of length 24 ([conversion.md](conversion.md), f → c), with the decimal separator of the decimal notation: `  1,5000000000000000E+00`, `-1,7976931348623157E+308`; zero has no sign |
| decfloat16, decfloat34 | **decfloat**, see below |
| utclong | **stamp**: the date with separators in the date format, a blank, `hh:mm:ss`, the decimal separator and seven digits, left-aligned (`29.02.2024 12:34:56,5000000` and three blanks); the initial value is 30 blanks. The time stamp is shown as it is stored, in UTC: the user's time zone does not apply |

**signed** (i, int8, b, s, p): the digits, the decimal separator and the decimals (p), the sign at the end (`-`
or a blank), right-aligned. Thousands separators go between groups of three integer digits. What does not fit
the output length is given up in this order:

1. thousands separators, one at a time from the left: i `-100000000` → `100000.000-`, int8
   `-12345678901234567` → `12345678901.234.567-`
2. the blank of a positive number: b `255` → `255`, p LENGTH 3 DECIMALS 5 `0.12345` → `0,12345`
3. the `0` before the decimal separator: p LENGTH 1 DECIMALS 1 `-0.5` → `,5-`

Thousands separators go before the blank: s `10000` is `10000 `, not `10.000`. The output lengths leave room for
every value of the type after these steps, so nothing is ever cut or replaced by `*`.

**decfloat**: the sign in front (`-` only), right-aligned. The scale does not count: zero (also `-0` and `0E+10`)
is `0`, and trailing zeros after the decimal separator are dropped (`1.00` is `1`, `1.000000000000000E+5` is
`100.000`).
- **mathematical notation** whenever the integer part with its sign fits the output length without separators:
  thousands separators as in *signed* step 1 (decfloat16 `1.234567890123456E+20` → `123456789012.345.600.000`),
  and as many decimals as fit, rounded half away from zero (`1.5E-22` → `0,0000000000000000000002`). A number
  that rounds to zero this way keeps its decimals, and a negative one its sign: decfloat16 `-4E-23` →
  `-0,000000000000000000000`.
- **scientific notation** otherwise (decfloat16 `1E+24`, `-1E+23`, decfloat34 `1E+46`): the coefficient as it is
  stored, one digit before the decimal separator, `E`, the sign and the exponent without leading zeros:
  `9,999999999999999E+384`, `1E+24`. The scale counts here: decfloat34 `1E+6144` is stored with 34 digits (its
  exponent is out of range otherwise) and is written `1,000000000000000000000000000000000E+6144`.

## The list

How outputs are placed on the line (open-abap-gui's list processor, ported in
[`runtime/go/abap/list.go`](../../runtime/go/abap/list.go)), as far as it matters for formatting:
- one blank between two outputs on a line, after the full output length of the first; an empty string counts as
  an output, so `` WRITE ``. WRITE 'b'. `` gives ` b`
- a line that holds only blanks is not output (the default of `SET BLANK LINES`): `WRITE / ''. WRITE / 'x'.`
  outputs only `x`
- a number literal is an i: `WRITE 1000.` outputs `     1.000 ` (default settings)

## The user setup file

A compiled program runs with the default settings (decimal notation blank, date format `1`, time format `0`,
language `E`, time zone `UTC`), or as a user from a user setup file:

```sh
program --user-setup users.json --user alice
```

```json
{
  "users": [
    { "user": "alice", "dateFormat": "2", "decimalNotation": "X" },
    { "user": "bob", "language": "D", "dateFormat": "4", "decimalNotation": "Y", "timeFormat": "0", "timeZone": "CET" }
  ]
}
```

The codes are those of the user master record. A field left out takes its default; `--user` may be left out when
the file has one user. A file, user or code the runtime cannot use ends the program before it runs, with exit
code 2. With a database, its user master records will override the file (see
[aot_for_abap.md](../aot_for_abap.md)).

## Known gaps

- b and s are not declared by the compiler yet (see the roadmap); their rules are implemented and tested.
- The date formats `7`–`C` and the 12-hour time formats (which may affect utclong) are not supported.
- Formatting additions (`DD/MM/YYYY`, `CURRENCY`, `DECIMALS`, `NO-GROUPING`, `LEFT-JUSTIFIED`, `USING EDIT MASK`,
  …), `WRITE … TO`, and positions and lengths (`WRITE AT /10(5)`) are not specified yet.
