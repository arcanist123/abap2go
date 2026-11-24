package abap

// decimal is an exact decimal number, the meeting point of the numeric conversion cells: a source is turned into a
// decimal without loss (f through its 17-digit decimal form, as ABAP does), and the target rounds it.

import (
	"math/big"
	"strconv"
	"strings"
)

// decimal is (-1)^neg * coef * 10^exp. coef is never negative. Zero may carry a sign (decfloat -0.0) and an exponent.
type decimal struct {
	neg  bool
	coef *big.Int
	exp  int
}

var (
	bigOne = big.NewInt(1)
	bigTen = big.NewInt(10)
	pow10s = []*big.Int{big.NewInt(1)}
	minI32 = big.NewInt(-1 << 31)
	maxI32 = big.NewInt(1<<31 - 1)
	minI64 = new(big.Int).Lsh(big.NewInt(-1), 63)
	maxI64 = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 63), bigOne)
)

// pow10 is 10^n, n >= 0. The result must not be modified.
func pow10(n int) *big.Int {
	for len(pow10s) <= n && len(pow10s) <= 400 {
		pow10s = append(pow10s, new(big.Int).Mul(pow10s[len(pow10s)-1], bigTen))
	}
	if n < len(pow10s) {
		return pow10s[n]
	}
	return new(big.Int).Exp(bigTen, big.NewInt(int64(n)), nil)
}

func decimalFromInt64(v int64) decimal {
	d := decimal{coef: big.NewInt(v)}
	if v < 0 {
		d.neg = true
		d.coef.Neg(d.coef)
	}
	return d
}

func (d decimal) isZero() bool { return d.coef.Sign() == 0 }

// digits is the decimal representation of coef.
func (d decimal) digits() string { return d.coef.String() }

// roundAway rounds to a multiple of 10^exp, half away from zero (ABAP's commercial rounding). Exact values keep
// their coefficient, scaled to exp.
func (d decimal) roundAway(exp int) decimal {
	r := decimal{neg: d.neg, exp: exp}
	if d.exp >= exp {
		r.coef = new(big.Int).Mul(d.coef, pow10(d.exp-exp))
		return r
	}
	div := pow10(exp - d.exp)
	q, m := new(big.Int).QuoRem(d.coef, div, new(big.Int))
	if m.Lsh(m, 1).Cmp(div) >= 0 {
		q.Add(q, bigOne)
	}
	r.coef = q
	return r
}

// signed is the value as a signed integer, for a decimal with exp 0.
func (d decimal) signed() *big.Int {
	v := new(big.Int).Set(d.coef)
	if d.neg {
		v.Neg(v)
	}
	return v
}

// integer rounds to an integer (half away from zero).
func (d decimal) integer() *big.Int { return d.roundAway(0).signed() }

// int32 rounds to an integer in the range of i, or reports overflow.
func (d decimal) int32() (int32, bool) {
	v := d.integer()
	if v.Cmp(minI32) < 0 || v.Cmp(maxI32) > 0 {
		return 0, false
	}
	return int32(v.Int64()), true
}

// int64 rounds to an integer in the range of int8, or reports overflow.
func (d decimal) int64() (int64, bool) {
	v := d.integer()
	if v.Cmp(minI64) < 0 || v.Cmp(maxI64) > 0 {
		return 0, false
	}
	return v.Int64(), true
}

// plain is the value in mathematical notation with -exp decimals (none for exp >= 0), '-' in front if negative.
func (d decimal) plain() string {
	s := d.digits()
	if d.exp > 0 {
		s += strings.Repeat("0", d.exp)
	} else if d.exp < 0 {
		n := -d.exp
		if len(s) <= n {
			s = strings.Repeat("0", n-len(s)+1) + s
		}
		s = s[:len(s)-n] + "." + s[len(s)-n:]
	}
	if d.neg {
		s = "-" + s
	}
	return s
}

// plainOrScientific is coef e exp with the sign, a form strconv.ParseFloat reads exactly (rounding once).
func (d decimal) plainOrScientific() string {
	s := d.digits() + "e" + strconv.Itoa(d.exp)
	if d.neg {
		s = "-" + s
	}
	return s
}

func bigOf(v int64) *big.Int { return big.NewInt(v) }

// parseDecimalDigits builds a decimal from a mantissa of digits with an optional point and a decimal exponent.
// The caller has checked the syntax.
func parseDecimalDigits(neg bool, mantissa string, exp int) decimal {
	intPart, frac, _ := strings.Cut(mantissa, ".")
	coef, _ := new(big.Int).SetString("0"+intPart+frac, 10)
	return decimal{neg: neg, coef: coef, exp: exp - len(frac)}
}
