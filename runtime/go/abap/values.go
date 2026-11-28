package abap

// The Go representations of p, decfloat16/34 and utclong, and helpers on fixed-length text in UTF-8: the text that
// the rules for numbers, dates and times read and write (see text.go; values of text kinds use textLeft and the
// other helpers there).

import (
	"math/big"
	"strings"
	"unicode/utf8"
)

// Packed is the value of a p field as an unscaled integer: p LENGTH 8 DECIMALS 2 holding 1.50 is Packed 150. At
// most 31 digits, so the magnitude fits 128 bits.
type Packed struct {
	neg    bool
	hi, lo uint64
}

// PackedFromInt64 is the unscaled integer v.
func PackedFromInt64(v int64) Packed { return packedFromBig(big.NewInt(v)) }

func packedFromBig(v *big.Int) Packed {
	m := new(big.Int).Abs(v)
	lo := new(big.Int).And(m, new(big.Int).SetUint64(^uint64(0)))
	return Packed{neg: v.Sign() < 0, hi: new(big.Int).Rsh(m, 64).Uint64(), lo: lo.Uint64()}
}

func (p Packed) big() *big.Int {
	v := new(big.Int).SetUint64(p.hi)
	v.Lsh(v, 64).Or(v, new(big.Int).SetUint64(p.lo))
	if p.neg {
		v.Neg(v)
	}
	return v
}

func (p Packed) decimal(decimals int) decimal {
	v := new(big.Int).SetUint64(p.hi)
	v.Lsh(v, 64).Or(v, new(big.Int).SetUint64(p.lo))
	return decimal{neg: p.neg && v.Sign() != 0, coef: v, exp: -decimals}
}

// Decfloat is the value of a decfloat16 or decfloat34 field: (-1)^neg * coef * 10^exp, with its scale (1.0 and
// 1.00 differ) and a signed zero, as IEEE 754 decimal floating point. The precision and exponent range belong
// to the type.
type Decfloat struct {
	neg    bool
	hi, lo uint64
	exp    int32
}

func decfloatFromDecimal(d decimal) Decfloat {
	lo := new(big.Int).And(d.coef, new(big.Int).SetUint64(^uint64(0)))
	return Decfloat{neg: d.neg, hi: new(big.Int).Rsh(d.coef, 64).Uint64(), lo: lo.Uint64(), exp: int32(d.exp)}
}

func (v Decfloat) decimal() decimal {
	c := new(big.Int).SetUint64(v.hi)
	c.Lsh(c, 64).Or(c, new(big.Int).SetUint64(v.lo))
	return decimal{neg: v.neg, coef: c, exp: int(v.exp)}
}

// decfloat precision and quantum exponent range (IEEE 754 decimal64 and decimal128).
type decfloatFormat struct {
	digits    int
	minExp    int // the exponent of the smallest subnormal quantum
	maxExp    int // the largest exponent of the coefficient's last digit
	maxAdjExp int
}

var (
	decfloat16Format = decfloatFormat{digits: 16, minExp: -398, maxExp: 369, maxAdjExp: 384}
	decfloat34Format = decfloatFormat{digits: 34, minExp: -6176, maxExp: 6111, maxAdjExp: 6144}
)

// toDecfloat rounds d into the format, half away from zero, keeping its scale where it fits. Too large is
// overflow; too small rounds to the smallest quantum (and may become zero).
func (f decfloatFormat) toDecfloat(d decimal) (Decfloat, bool) {
	r := decimal{neg: d.neg, coef: d.coef, exp: d.exp}
	if n := len(r.digits()); r.coef.Sign() != 0 && n > f.digits {
		r = r.roundAway(r.exp + n - f.digits)
		if len(r.digits()) > f.digits {
			r = r.roundAway(r.exp + 1)
		}
	}
	// an exponent can be far outside the format (a text holds any), so no power of ten is built from it unchecked
	if r.exp < f.minExp {
		if f.minExp-r.exp > len(r.digits()) {
			r = decimal{neg: r.neg, coef: new(big.Int), exp: f.minExp} // less than a tenth of the quantum
		} else {
			r = r.roundAway(f.minExp)
		}
	}
	if r.exp > f.maxExp {
		if r.coef.Sign() == 0 {
			r.exp = f.maxExp
		} else if r.exp-f.maxExp >= f.digits {
			return Decfloat{}, false
		} else {
			r = decimal{neg: r.neg, coef: new(big.Int).Mul(r.coef, pow10(r.exp-f.maxExp)), exp: f.maxExp}
			if len(r.digits()) > f.digits {
				return Decfloat{}, false
			}
		}
	}
	return decfloatFromDecimal(r), true
}

// Utclong is the value of a utclong field: 0 is the initial value, otherwise 1 plus the number of 100 ns ticks
// since 0001-01-01 00:00:00 on ABAP's calendar (Julian before 1582-10-15).
type Utclong int64

const (
	ticksPerSecond = 10_000_000
	ticksPerDay    = 86400 * ticksPerSecond
)

// blanks is n blanks.
func blanks(n int) string { return strings.Repeat(" ", n) }

// zeros is n zeros.
func zeros(n int) string { return strings.Repeat("0", n) }

// fitLeft places s left-aligned in n characters: cut on the right, or padded with pad.
func fitLeft(s string, n int, pad string) string {
	l := utf8.RuneCountInString(s)
	if l >= n {
		if l == len(s) {
			return s[:n]
		}
		return string([]rune(s)[:n])
	}
	return s + strings.Repeat(pad, n-l)
}

// fitRight places s right-aligned in n characters: cut on the left, or padded with pad.
func fitRight(s string, n int, pad string) string {
	l := utf8.RuneCountInString(s)
	if l >= n {
		if l == len(s) {
			return s[len(s)-n:]
		}
		r := []rune(s)
		return string(r[len(r)-n:])
	}
	return strings.Repeat(pad, n-l) + s
}

// trimBlanksRight removes trailing blanks, as the conversion of a text field to string does.
func trimBlanksRight(s string) string { return strings.TrimRight(s, " ") }

// fitBytesLeft places bytes left-aligned in n bytes: cut on the right, or padded with zero bytes.
func fitBytesLeft(b string, n int) string {
	if len(b) >= n {
		return b[:n]
	}
	return b + strings.Repeat("\x00", n-len(b))
}

// fitBytesRight places bytes right-aligned in n bytes: cut on the left, or padded with zero bytes in front.
func fitBytesRight(b string, n int) string {
	if len(b) >= n {
		return b[len(b)-n:]
	}
	return strings.Repeat("\x00", n-len(b)) + b
}
