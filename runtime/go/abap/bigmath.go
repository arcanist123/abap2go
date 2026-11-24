package abap

// a ** b for decfloat34 with an exponent that is not a (small) integer: exp( b * ln( a ) ) in binary floating
// point with far more precision than the 34 digits of the result.

import (
	"math/big"
	"strconv"
	"strings"
)

const powPrec = 640 // bits, about 190 decimal digits

// powReal is a ** b for a > 0, rounded to digits significant digits.
func powReal(a, b decimal, digits int) decimal {
	x := bigFloatOf(a)
	y := bigFloatOf(b)
	r := bigExp(new(big.Float).SetPrec(powPrec).Mul(y, bigLn(x)))
	return decimalOfBigFloat(r, digits)
}

func bigFloatOf(d decimal) *big.Float {
	f, _, err := big.ParseFloat(d.plainOrScientific(), 10, powPrec, big.ToNearestEven)
	if err != nil {
		panic(err)
	}
	return f
}

// decimalOfBigFloat rounds f (positive) to digits significant digits, half away from zero.
func decimalOfBigFloat(f *big.Float, digits int) decimal {
	s := f.Text('e', digits+20)
	mant, expText, _ := strings.Cut(s, "e")
	exp, _ := strconv.Atoi(expText)
	d := parseDecimalDigits(false, mant, exp)
	r, _ := d.roundSignificant(digits)
	return r
}

func newFloat() *big.Float { return new(big.Float).SetPrec(powPrec) }

var ln2Cache *big.Float

// ln2 = 2 atanh(1/3).
func ln2() *big.Float {
	if ln2Cache == nil {
		third := newFloat().Quo(newFloat().SetInt64(1), newFloat().SetInt64(3))
		ln2Cache = atanh2(third)
	}
	return ln2Cache
}

// atanh2 is 2 atanh(z) = ln((1+z)/(1-z)) for a small |z|, by its series.
func atanh2(z *big.Float) *big.Float {
	z2 := newFloat().Mul(z, z)
	term := newFloat().Set(z)
	sum := newFloat().Set(z)
	eps := newFloat().SetMantExp(newFloat().SetInt64(1), -powPrec)
	for k := int64(3); ; k += 2 {
		term.Mul(term, z2)
		t := newFloat().Quo(term, newFloat().SetInt64(k))
		if newFloat().Abs(t).Cmp(eps) < 0 {
			break
		}
		sum.Add(sum, t)
	}
	return sum.Mul(sum, newFloat().SetInt64(2))
}

// bigLn is ln(x) for x > 0: x = m * 2^k with m in [0.5, 1), ln(m) = 2 atanh((m-1)/(m+1)).
func bigLn(x *big.Float) *big.Float {
	m := newFloat()
	k := x.MantExp(m)
	one := newFloat().SetInt64(1)
	z := newFloat().Quo(newFloat().Sub(m, one), newFloat().Add(m, one))
	r := atanh2(z)
	return r.Add(r, newFloat().Mul(ln2(), newFloat().SetInt64(int64(k))))
}

// bigExp is e^y: y = k ln2 + r, e^r by its series on r / 2^16, squared back.
func bigExp(y *big.Float) *big.Float {
	kf := newFloat().Quo(y, ln2())
	ki, _ := kf.Int(nil)
	if kf.Sign() < 0 {
		ki.Sub(ki, bigOne)
	}
	k := ki.Int64()
	r := newFloat().Sub(y, newFloat().Mul(ln2(), newFloat().SetInt64(k)))
	const halvings = 16
	r.SetMantExp(r, -halvings)
	sum := newFloat().SetInt64(1)
	term := newFloat().SetInt64(1)
	eps := newFloat().SetMantExp(newFloat().SetInt64(1), -powPrec)
	for n := int64(1); ; n++ {
		term.Mul(term, r)
		term.Quo(term, newFloat().SetInt64(n))
		if newFloat().Abs(term).Cmp(eps) < 0 {
			break
		}
		sum.Add(sum, term)
	}
	for i := 0; i < halvings; i++ {
		sum.Mul(sum, sum)
	}
	return sum.SetMantExp(sum, int(k))
}
