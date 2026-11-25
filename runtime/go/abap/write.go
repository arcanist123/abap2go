package abap

// WRITE formatting: how WRITE puts an elementary value onto a list, specified in docs/spec/write.md. Every kind
// has an output length, and the text always has exactly that many characters (a string: its own length). The
// rules are not those of the conversion to text: numbers get thousands separators and the user's decimal
// separator, a date is reordered to the user's date format, decfloat drops its scale.

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
)

// Format is the text WRITE outputs for v of type t, with the user settings of the session, as ABAP text (UTF-16
// code units, see text.go).
func Format(settings Settings, t Type, v any) string {
	switch t.Kind {
	case KindC, KindN, KindT, KindString:
		return v.(string)
	case KindD:
		return formatDate(settings, v.(string))
	}
	return FromUTF8(format8(settings, t, v))
}

// format8 is Format for the kinds that are not text, as UTF-8.
func format8(settings Settings, t Type, v any) string {
	switch t.Kind {
	case KindX, KindXString:
		return strings.ToUpper(hex.EncodeToString([]byte(v.(string))))
	case KindI:
		return formatInteger(settings, int64(v.(int32)), 11)
	case KindInt8:
		return formatInteger(settings, v.(int64), 20)
	case KindB:
		return formatInteger(settings, int64(v.(uint8)), 3)
	case KindS:
		return formatInteger(settings, int64(v.(int16)), 6)
	case KindP:
		return formatPacked(settings, v.(Packed).decimal(t.Decimals), OutputLength(t))
	case KindF:
		dec, _ := settings.separators()
		return strings.Replace(floatToC(v.(float64), 24), ".", string(dec), 1)
	case KindDecfloat16, KindDecfloat34:
		return formatDecfloat(settings, v.(Decfloat).decimal(), OutputLength(t))
	case KindUtclong:
		return formatUtclongWrite(settings, v.(Utclong))
	}
	panic(fmt.Sprintf("abap: no WRITE format for %v", t))
}

// OutputLength is the output length of a flat type: the number of characters WRITE outputs. A string or xstring
// has no fixed output length (0 here); WRITE outputs it with its own length.
func OutputLength(t Type) int {
	switch t.Kind {
	case KindC, KindN:
		return t.Length
	case KindX:
		return 2 * t.Length
	case KindD:
		return 8
	case KindT:
		return 6
	case KindI:
		return 11
	case KindInt8:
		return 20
	case KindB:
		return 3
	case KindS:
		return 6
	case KindP:
		if t.Decimals > 0 {
			return 2*t.Length + 1
		}
		return 2 * t.Length
	case KindF, KindDecfloat16:
		return 24
	case KindDecfloat34:
		return 46
	case KindUtclong:
		return 30
	}
	return 0
}

// formatDate reorders the eight characters YYYYMMDD to the order of the user's date format, without separators.
// Any characters are reordered, valid date or not. d is ABAP text: eight code units.
func formatDate(settings Settings, d string) string {
	switch settings.DateFormat {
	case '1':
		return d[12:16] + d[8:12] + d[0:8]
	case '2', '3':
		return d[8:12] + d[12:16] + d[0:8]
	}
	return d
}

// dateWithSeparators is the date in the user's date format with its separators: 29.02.2024, 02/29/2024, ...
func dateWithSeparators(settings Settings, y, m, d int) string {
	switch settings.DateFormat {
	case '1':
		return fmt.Sprintf("%02d.%02d.%04d", d, m, y)
	case '2':
		return fmt.Sprintf("%02d/%02d/%04d", m, d, y)
	case '3':
		return fmt.Sprintf("%02d-%02d-%04d", m, d, y)
	case '4':
		return fmt.Sprintf("%04d.%02d.%02d", y, m, d)
	case '5':
		return fmt.Sprintf("%04d/%02d/%02d", y, m, d)
	}
	return fmt.Sprintf("%04d-%02d-%02d", y, m, d)
}

// formatUtclong is the date in the user's date format, a blank, hh:mm:ss, the decimal separator and seven
// digits, left-aligned in 30 characters, with no time zone conversion. The initial value is blanks.
func formatUtclongWrite(settings Settings, u Utclong) string {
	if u == 0 {
		return blanks(30)
	}
	ticks := int64(u) - 1
	y, m, d := dateOf(int(ticks / ticksPerDay))
	t := ticks % ticksPerDay
	sec := t / ticksPerSecond
	dec, _ := settings.separators()
	s := fmt.Sprintf("%s %02d:%02d:%02d%c%07d", dateWithSeparators(settings, y, m, d), sec/3600, sec/60%60, sec%60, dec, t%ticksPerSecond)
	return fitLeft(s, 30, " ")
}

// groupDigits puts the thousands separator into the integer digits, at most groups times, from the right.
func groupDigits(digits string, sep byte, groups int) string {
	var b strings.Builder
	n := len(digits)
	for i := 0; i < n; i++ {
		if left := n - i; i > 0 && left%3 == 0 && left/3 <= groups {
			b.WriteByte(sep)
		}
		b.WriteByte(digits[i])
	}
	return b.String()
}

// numberText lays out integer digits and decimals in width characters, the separators as fit: first all
// thousands separators, then one fewer at a time from the left, then none. ok is false if not even that fits.
func numberText(integer, fraction string, sign string, signFirst bool, dec, thousands byte, width int) (string, bool) {
	for groups := (len(integer) - 1) / 3; groups >= 0; groups-- {
		s := groupDigits(integer, thousands, groups)
		if fraction != "" {
			s += string(dec) + fraction
		}
		if signFirst {
			s = sign + s
		} else {
			s += sign
		}
		if len(s) <= width {
			return fitRight(s, width, " "), true
		}
	}
	return "", false
}

// formatSigned lays out an integer or packed number with the sign at the end: '-' or a blank. What does not fit
// is given up in this order: thousands separators (from the left), the blank of a positive number, the 0 before
// the decimal separator.
func formatSigned(settings Settings, d decimal, width int) string {
	dec, thousands := settings.separators()
	text := decimal{coef: d.coef, exp: d.exp}.plain()
	integer, fraction, _ := strings.Cut(text, ".")
	neg := d.neg && !d.isZero()
	sign := " "
	if neg {
		sign = "-"
	}
	if s, ok := numberText(integer, fraction, sign, false, dec, thousands, width); ok {
		return s
	}
	if !neg {
		if s, ok := numberText(integer, fraction, "", false, dec, thousands, width); ok {
			return s
		}
		sign = ""
	}
	if integer == "0" && fraction != "" {
		if s, ok := numberText("", fraction, sign, false, dec, thousands, width); ok {
			return s
		}
	}
	// The output lengths leave room for every value, so this is not reached.
	panic(fmt.Sprintf("abap: %s does not fit %d characters", text, width))
}

func formatInteger(settings Settings, v int64, width int) string {
	return formatSigned(settings, decimalFromInt64(v), width)
}

func formatPacked(settings Settings, d decimal, width int) string {
	return formatSigned(settings, d, width)
}

// formatDecfloat lays out a decfloat with its sign in front. Its scale does not count: zero is 0, and trailing
// zeros after the decimal separator are dropped. In mathematical notation with the thousands separators that
// fit, rounded (half away from zero) to as many decimals as fit, even if that rounds to zero; a negative number
// keeps its sign then. If the integer part does not fit even without separators, scientific notation instead:
// the coefficient as it is stored, one digit before the decimal separator, and the exponent without leading
// zeros.
func formatDecfloat(settings Settings, d decimal, width int) string {
	if d.isZero() {
		return fitRight("0", width, " ")
	}
	dec, thousands := settings.separators()
	sign := ""
	if d.neg {
		sign = "-"
	}
	n := decimal{coef: new(big.Int).Set(d.coef), exp: d.exp}
	for n.exp < 0 {
		q, r := new(big.Int).QuoRem(n.coef, bigTen, new(big.Int))
		if r.Sign() != 0 {
			break
		}
		n.coef, n.exp = q, n.exp+1
	}
	if intDigits := len(n.digits()) + n.exp; intDigits+len(sign) <= width {
		for k := max(0, -n.exp); k >= 0; k-- {
			text := n.roundAway(-k).plain()
			integer, fraction, _ := strings.Cut(text, ".")
			if s, ok := numberText(integer, fraction, sign, true, dec, thousands, width); ok {
				return s
			}
		}
	}
	c := d.digits()
	s := sign + c[:1]
	if len(c) > 1 {
		s += string(dec) + c[1:]
	}
	return fitRight(s+exponentText(d.exp+len(c)-1, 1), width, " ")
}
