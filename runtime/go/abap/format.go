package abap

// Number to text: the conversions of i, int8, b, s, p, f and decfloat to c and string.

import (
	"math"
	"math/big"
	"strconv"
	"strings"
)

// signedText is an integer or packed number for a text target: digits with the decimal point, then the sign
// character, '-' or a blank (so i 7 becomes "7 " in a string).
func signedText(d decimal) (text string, sign string) {
	t := decimal{coef: d.coef, exp: d.exp}.plain()
	if d.neg && d.coef.Sign() != 0 {
		return t, "-"
	}
	return t, " "
}

// numberToC places an integer or packed number in c LENGTH n: right-aligned with the sign character after it. A
// positive number may drop its blank to fit. A number below 1 may drop the 0 before the point. If it still does
// not fit, the first character is * and the rest is the end of the number.
func numberToC(d decimal, n int) string {
	text, sign := signedText(d)
	try := func(t string) (string, bool) {
		if len(t)+1 <= n {
			return fitRight(t+sign, n, " "), true
		}
		if sign == " " && len(t) <= n {
			return fitRight(t, n, " "), true
		}
		return "", false
	}
	if r, ok := try(text); ok {
		return r
	}
	if strings.HasPrefix(text, "0.") {
		text = text[1:]
		if r, ok := try(text); ok {
			return r
		}
	}
	if sign == "-" {
		text += "-"
	}
	return "*" + text[len(text)-(n-1):]
}

// numberToString is the number with its sign character: "7 ", "1.50-".
func numberToString(d decimal) string {
	text, sign := signedText(d)
	return text + sign
}

// exactFloat is the exact decimal value of a finite float64.
func exactFloat(v float64) decimal {
	r := new(big.Rat).SetFloat64(math.Abs(v))
	num, den := r.Num(), r.Denom()
	k := den.BitLen() - 1 // den is a power of two
	coef := new(big.Int).Mul(num, new(big.Int).Exp(big.NewInt(5), big.NewInt(int64(k)), nil))
	return decimal{neg: math.Signbit(v) && v != 0, coef: coef, exp: -k}
}

// floatDecimal is f in its decimal form with sig significant digits, the way ABAP turns an f into a decimal
// number (17 digits for p, integers and n, 16 for decfloat16). Trailing zeros remain.
func floatDecimal(v float64, sig int) decimal {
	s := strconv.FormatFloat(v, 'e', sig-1, 64)
	mant, expText, _ := strings.Cut(s, "e")
	exp, _ := strconv.Atoi(expText)
	neg := strings.HasPrefix(mant, "-")
	mant = strings.TrimPrefix(mant, "-")
	d := parseDecimalDigits(neg && v != 0, mant, exp)
	return d
}

// significant rounds a non-zero d to digits significant digits, half away from zero, and returns them with the
// exponent of the first digit.
func significant(d decimal, digits int) (string, int) {
	adj := d.exp + len(d.digits()) - 1
	r := d.roundAway(adj - digits + 1)
	if len(r.digits()) > digits {
		adj++
		r = d.roundAway(adj - digits + 1)
	}
	return r.digits(), adj
}

// exponentText is E, the sign and the exponent with at least minDigits digits.
func exponentText(e int, minDigits int) string {
	sign := "+"
	if e < 0 {
		sign = "-"
		e = -e
	}
	s := strconv.Itoa(e)
	for len(s) < minDigits {
		s = "0" + s
	}
	return "E" + sign + s
}

// floatToString is f in scientific notation with 17 significant digits: -1.5000000000000000E+00. Zero has no sign.
func floatToString(v float64) string {
	s := strconv.FormatFloat(v, 'E', 16, 64)
	if v == 0 {
		s = strings.TrimPrefix(s, "-")
	}
	return s
}

// floatToC places f in c LENGTH n in scientific notation with as many decimals as fit (at most 16), right-aligned
// with a place for the sign. The exponent has at least two digits. A positive number may use the sign's place
// for a mantissa without decimals; if even that does not fit, the field is filled with *.
func floatToC(v float64, n int) string {
	d := exactFloat(v)
	neg := d.neg
	body := func(k int) string {
		if d.isZero() {
			m := "0"
			if k > 0 {
				m += "." + zeros(k)
			}
			return m + "E+00"
		}
		digits, adj := significant(d, k+1)
		m := digits[:1]
		if k > 0 {
			m += "." + digits[1:]
		}
		return m + exponentText(adj, 2)
	}
	sign := " "
	if neg {
		sign = "-"
	}
	for k := 16; k >= 0; k-- {
		if b := body(k); len(b)+1 <= n {
			return fitRight(sign+b, n, " ")
		}
	}
	if b := body(0); !neg && len(b) <= n {
		return fitRight(b, n, " ")
	}
	return strings.Repeat("*", n)
}

// decfloatString is the decfloat in IEEE 754 scientific string form: plain notation when the exponent is at most
// 0 and the adjusted exponent at least -6, else d.dddE+n. The scale is kept: 1.00, 1E+3, 0.000001, 1E-7, -0.0.
func decfloatString(d decimal) string {
	c := d.digits()
	adj := d.exp + len(c) - 1
	var s string
	if d.exp <= 0 && adj >= -6 {
		s = decimal{coef: d.coef, exp: d.exp}.plain()
	} else {
		s = c[:1]
		if len(c) > 1 {
			s += "." + c[1:]
		}
		s += exponentText(adj, 1)
	}
	if d.neg {
		s = "-" + s
	}
	return s
}

// decfloatToC places a decfloat in c LENGTH n, right-aligned. Its string form if it fits; else whichever keeps
// more significant digits of the mathematical notation rounded to fewer decimals (half away from zero, never
// rounding a number other than zero to zero) and the scientific notation with as many mantissa digits as fit
// (minimal exponent digits); else overflow.
func decfloatToC(d decimal, n int) (string, error) {
	if s := decfloatString(d); len(s) <= n {
		return fitRight(s, n, " "), nil
	}
	plainText, mathSig := "", -1
	for k := max(0, -d.exp); k >= 0; k-- {
		r := d.roundAway(-k)
		s := r.plain()
		if len(s) > n {
			continue
		}
		if r.isZero() && !d.isZero() {
			break
		}
		plainText, mathSig = s, len(strings.TrimLeft(r.digits(), "0"))
		break
	}
	sci, sciSig := "", -1
	if !d.isZero() {
		for m := 40; m >= 0; m-- {
			digits, adj := significant(d, m+1)
			s := digits[:1]
			if m > 0 {
				s += "." + digits[1:]
			}
			s += exponentText(adj, 1)
			if d.neg {
				s = "-" + s
			}
			if len(s) <= n {
				sci, sciSig = s, m+1
				break
			}
		}
	}
	switch {
	case mathSig >= 0 && mathSig >= sciSig:
		return fitRight(plainText, n, " "), nil
	case sciSig >= 0:
		return fitRight(sci, n, " "), nil
	}
	return "", errOverflow
}
