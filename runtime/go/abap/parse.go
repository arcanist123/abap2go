package abap

// Text to number, hex and utclong: the rules a text source (c, string, and n through them) follows.

import (
	"fmt"
	"math"
	"math/big"
	"strconv"
	"strings"
)

// parseNumber reads a number for the targets i, int8, b, s, p and decfloat (allowExp).
//
// Blanks around the number are ignored; blank text is 0. A sign goes in front, optionally followed by blanks, or
// at the end, optionally preceded by blanks, not both. The mantissa is digits with at most one point and at least
// one digit. With allowExp (decfloat) an exponent E or e with an optional sign and digits may follow; the number is
// then one token: no blank after a leading sign and no sign at the end.
func parseNumber(text string, allowExp bool) (decimal, bool) {
	s := strings.Trim(text, " ")
	if s == "" {
		return decimal{coef: new(big.Int)}, true
	}
	if allowExp {
		if i := strings.IndexAny(s, "Ee"); i >= 0 {
			neg := false
			mant := s[:i]
			if mant != "" && (mant[0] == '+' || mant[0] == '-') {
				neg = mant[0] == '-'
				mant = mant[1:]
			}
			expText := s[i+1:]
			if !isMantissa(mant) || !isSignedDigits(expText) {
				return decimal{}, false
			}
			exp, err := strconv.Atoi(expText)
			if err != nil {
				return decimal{}, false // beyond any range: the exponent alone cannot be held
			}
			return parseDecimalDigits(neg, mant, exp), true
		}
	}
	neg := false
	switch {
	case s[0] == '+' || s[0] == '-':
		neg = s[0] == '-'
		s = strings.TrimLeft(s[1:], " ")
	case s[len(s)-1] == '+' || s[len(s)-1] == '-':
		neg = s[len(s)-1] == '-'
		s = strings.TrimRight(s[:len(s)-1], " ")
	}
	if !isMantissa(s) {
		return decimal{}, false
	}
	return parseDecimalDigits(neg, s, 0), true
}

// isMantissa: digits with at most one point, at least one digit.
func isMantissa(s string) bool {
	digits, points := 0, 0
	for i := 0; i < len(s); i++ {
		switch {
		case s[i] >= '0' && s[i] <= '9':
			digits++
		case s[i] == '.':
			points++
		default:
			return false
		}
	}
	return digits > 0 && points <= 1
}

func isSignedDigits(s string) bool {
	if s != "" && (s[0] == '+' || s[0] == '-') {
		s = s[1:]
	}
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// parseFloat reads a number for the target f. It follows its own rules, those of C's strtod plus a sign at the
// end:
//   - trailing blanks are ignored, blank text is 0;
//   - text starting with a blank: the longest number prefix (after the blanks) is taken, and what follows must
//     start with a blank; with no number prefix at all the value is 0;
//   - otherwise the text must start with a number, which may be followed directly by a sign (+ or -, only if
//     the number has none in front) and then blanks, or by blanks; anything after those blanks is ignored
//     (7 - is 7);
//   - a number is an optional sign, digits with an optional point, and an optional exponent; INF, INFINITY and
//     NAN (any case) are not finite, which is an overflow, as is any value beyond the range of f.
//
// On an error the value is what the target is left with: for CX_SY_CONVERSION_NO_NUMBER the number that was read
// (0 if none), for CX_SY_CONVERSION_OVERFLOW +Inf or -Inf (NaN for NAN). The overflow wins over the error.
func parseFloat(text string) (float64, error) {
	s := strings.TrimRight(text, " ")
	if s == "" {
		return 0, nil
	}
	leadingBlank := s[0] == ' '
	start := len(s) - len(strings.TrimLeft(s, " "))
	n, numText := floatPrefix(s[start:])
	if n == 0 {
		if leadingBlank {
			return 0, nil
		}
		return 0, errNoNumber
	}
	v, err := strconv.ParseFloat(numText, 64)
	if err != nil && !math.IsInf(v, 0) && !math.IsNaN(v) {
		return 0, errNoNumber
	}
	if v == 0 {
		v = 0 // no negative zero from text
	}
	if math.IsNaN(v) {
		v = floatNaN
	}
	rest := s[start+n:]
	if leadingBlank {
		if rest != "" && rest[0] != ' ' {
			return leftFloat(v)
		}
	} else if rest != "" {
		switch rest[0] {
		case '+', '-':
			if len(rest) > 1 && rest[1] != ' ' || numText[0] == '+' || numText[0] == '-' {
				return leftFloat(v) // -1- has two signs
			}
			if rest[0] == '-' && v != 0 {
				v = -v
			}
		case ' ':
			// anything after a blank is ignored, a sign too
		default:
			return leftFloat(v)
		}
	}
	if math.IsInf(v, 0) || math.IsNaN(v) {
		return v, errOverflow
	}
	return v, nil
}

// leftFloat is the error for a text whose number prefix v is followed by something else.
func leftFloat(v float64) (float64, error) {
	if math.IsInf(v, 0) || math.IsNaN(v) {
		return v, errOverflow
	}
	return v, errNoNumber
}

// floatNaN is the NaN ABAP leaves in an f after NAN: the quiet NaN with an empty payload.
var floatNaN = math.Float64frombits(0x7FF8000000000000)

// floatPrefix is the length of the longest number at the start of s, as strtod reads it (no hexadecimal), and
// the number in a form strconv.ParseFloat accepts.
func floatPrefix(s string) (int, string) {
	i := 0
	if i < len(s) && (s[i] == '+' || s[i] == '-') {
		i++
	}
	lower := strings.ToLower(s[i:])
	for _, inf := range []string{"infinity", "inf", "nan"} {
		if strings.HasPrefix(lower, inf) {
			if inf == "nan" {
				return i + len(inf), "NaN" // not finite: an overflow
			}
			return i + len(inf), s[:i] + "Inf" // not finite: an overflow
		}
	}
	digits := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
		digits++
	}
	if i < len(s) && s[i] == '.' {
		i++
		for i < len(s) && s[i] >= '0' && s[i] <= '9' {
			i++
			digits++
		}
	}
	if digits == 0 {
		return 0, ""
	}
	if i < len(s) && (s[i] == 'e' || s[i] == 'E') {
		j := i + 1
		if j < len(s) && (s[j] == '+' || s[j] == '-') {
			j++
		}
		if j < len(s) && s[j] >= '0' && s[j] <= '9' {
			for j < len(s) && s[j] >= '0' && s[j] <= '9' {
				j++
			}
			i = j
		}
	}
	return i, s[:i]
}

// hexPrefix reads the hexadecimal digits (0-9, A-F, upper case only) at the start of text, up to the first other
// character, as bytes; an odd last digit is completed with 0.
func hexPrefix(text string) string {
	n := 0
	for n < len(text) && isUpperHex(text[n]) {
		n++
	}
	h := text[:n]
	if n%2 == 1 {
		h += "0"
	}
	b := make([]byte, len(h)/2)
	for i := range b {
		b[i] = hexValue(h[2*i])<<4 | hexValue(h[2*i+1])
	}
	return string(b)
}

func isUpperHex(c byte) bool { return c >= '0' && c <= '9' || c >= 'A' && c <= 'F' }

func hexValue(c byte) byte {
	if c <= '9' {
		return c - '0'
	}
	return c - 'A' + 10
}

// parseUtclong reads a time stamp: YYYY-MM-DD, a blank or T, hh:mm:ss, optionally a point or comma with up to
// seven digits of fraction, then only blanks. Blank text is the initial value. 24:00:00 is the next day. Dates
// follow ABAP's calendar, except that the days skipped by the Gregorian reform are refused.
func parseUtclong(text string) (Utclong, error) {
	s := strings.TrimRight(text, " ")
	if s == "" {
		return 0, nil
	}
	if len(s) < 19 || s[4] != '-' || s[7] != '-' || (s[10] != ' ' && s[10] != 'T') || s[13] != ':' || s[16] != ':' {
		return 0, errNoDateTime
	}
	y, ok1 := digitsValue(s[0:4])
	mo, ok2 := digitsValue(s[5:7])
	d, ok3 := digitsValue(s[8:10])
	h, ok4 := digitsValue(s[11:13])
	mi, ok5 := digitsValue(s[14:16])
	sec, ok6 := digitsValue(s[17:19])
	if !ok1 || !ok2 || !ok3 || !ok4 || !ok5 || !ok6 {
		return 0, errNoDateTime
	}
	frac := 0
	if rest := s[19:]; rest != "" {
		if rest[0] != '.' && rest[0] != ',' || len(rest) > 8 {
			return 0, errNoDateTime
		}
		digits := rest[1:]
		if digits != "" {
			v, ok := digitsValue(digits)
			if !ok {
				return 0, errNoDateTime
			}
			frac = v
			for i := len(digits); i < 7; i++ {
				frac *= 10
			}
		}
	}
	if !validDate(y, mo, d) || y == 1582 && mo == 10 && d > 4 && d < 15 {
		return 0, errNoDateTime
	}
	if mi > 59 || sec > 59 || h > 24 || h == 24 && (mi != 0 || sec != 0 || frac != 0) {
		return 0, errNoDateTime
	}
	ticks := int64(dayNumber(y, mo, d))*ticksPerDay + int64(h*3600+mi*60+sec)*ticksPerSecond + int64(frac)
	if ticks >= int64(maxDayNumber+1)*ticksPerDay {
		return 0, errNoDateTime
	}
	return Utclong(ticks + 1), nil
}

// formatUtclong is YYYY-MM-DD hh:mm:ss.fffffff, "" for the initial value.
func formatUtclong(u Utclong) string {
	if u == 0 {
		return ""
	}
	ticks := int64(u) - 1
	y, m, d := dateOf(int(ticks / ticksPerDay))
	t := ticks % ticksPerDay
	sec := t / ticksPerSecond
	return fmt.Sprintf("%04d-%02d-%02d %02d:%02d:%02d.%07d", y, m, d, sec/3600, sec/60%60, sec%60, t%ticksPerSecond)
}
