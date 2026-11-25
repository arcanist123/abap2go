package abap

// Exact decimal arithmetic for the calculation types p and decfloat34: sums, products and quotients of decimals
// with their scale, rounding to a number of significant digits, and the Euclidean division.

import "math/big"

// negated is -d (a zero changes its sign too).
func (d decimal) negated() decimal { return decimal{neg: !d.neg, coef: d.coef, exp: d.exp} }

// abs is d without its sign.
func (d decimal) abs() decimal { return decimal{coef: d.coef, exp: d.exp} }

// adjusted is the exponent of the first digit (0 for 1 to 9.99…, -1 for 0.1 to 0.99…). Zero gives exp.
func (d decimal) adjusted() int {
	if d.isZero() {
		return d.exp
	}
	return d.exp + len(d.digits()) - 1
}

// integerDigits is the number of digits before the decimal point (0 for a number below 1).
func (d decimal) integerDigits() int {
	if d.isZero() {
		return 0
	}
	return max(0, d.adjusted()+1)
}

// normalized drops the trailing zeros of the coefficient, raising the exponent; zero becomes 0 with exponent 0.
func (d decimal) normalized() decimal {
	if d.isZero() {
		return decimal{coef: new(big.Int)}
	}
	c, e := new(big.Int).Set(d.coef), d.exp
	r := new(big.Int)
	for {
		q, m := new(big.Int).QuoRem(c, bigTen, r)
		if m.Sign() != 0 {
			break
		}
		c, e = q, e+1
	}
	return decimal{neg: d.neg, coef: c, exp: e}
}

// withoutTrailingZeros drops trailing zeros after the decimal point only: 2.10 becomes 2.1, 100 stays 100.
func (d decimal) withoutTrailingZeros() decimal {
	n := d.normalized()
	if n.exp > 0 && d.exp <= 0 {
		return d.roundAway(0)
	}
	if d.isZero() {
		return decimal{neg: d.neg, coef: new(big.Int)}
	}
	if n.exp > d.exp {
		return n
	}
	return d
}

// aligned is the signed coefficients of a and b at the smaller exponent of the two.
func aligned(a, b decimal) (x, y *big.Int, exp int) {
	exp = min(a.exp, b.exp)
	x = new(big.Int).Mul(a.coef, pow10(a.exp-exp))
	y = new(big.Int).Mul(b.coef, pow10(b.exp-exp))
	if a.neg {
		x.Neg(x)
	}
	if b.neg {
		y.Neg(y)
	}
	return x, y, exp
}

// fromSigned is v * 10^exp; a zero result is negative only if neg.
func fromSigned(v *big.Int, exp int, negZero bool) decimal {
	d := decimal{neg: v.Sign() < 0, coef: new(big.Int).Abs(v), exp: exp}
	if v.Sign() == 0 {
		d.neg = negZero
	}
	return d
}

// decSum is the exact a + b at the smaller exponent. A zero sum is negative only if both operands are negative
// (IEEE 754: -0 + -0 is -0, anything else that cancels is +0).
func decSum(a, b decimal) decimal {
	x, y, exp := aligned(a, b)
	return fromSigned(x.Add(x, y), exp, a.neg && b.neg)
}

// decProduct is the exact a * b: the exponents add, the sign is the exclusive or of the signs (also for zero).
func decProduct(a, b decimal) decimal {
	return decimal{neg: a.neg != b.neg, coef: new(big.Int).Mul(a.coef, b.coef), exp: a.exp + b.exp}
}

// pProduct is the exact a * b of a p calculation with the scale ABAP gives it. The digits of an operand count in
// pairs (the bytes of a packed number): an operand whose coefficient ends in t zeros has j = ceil(t / 2) pairs of
// them. The product has one decimal more than the two operands together, less two for each such pair of both
// operands but one (2.00 * 2.00 is 4.000, 2.5 * 2.5 is 6.250, 7 * 1 is 7.0, 2.000 * 2.000 is 4.0), but not below
// zero decimals (20.0 * 10 is 200, 20.00 * 1 is 20.0).
func pProduct(a, b decimal) decimal {
	p := decProduct(a, b)
	if p.isZero() {
		return p
	}
	pairs := max(0, (trailingZeros(a.coef)+1)/2+(trailingZeros(b.coef)+1)/2-1)
	decimals := -p.exp + 1
	pairs = min(pairs, max(0, decimals/2))
	shift := 1 - 2*pairs
	if shift >= 0 {
		p.coef.Mul(p.coef, pow10(shift))
	} else {
		p.coef.Quo(p.coef, pow10(-shift))
	}
	p.exp -= shift
	return p
}

// trailingZeros is the number of zeros a non-zero coefficient ends in. It runs twice for every p product, so an odd
// coefficient and one that fits a uint64 are counted without big.Int arithmetic.
func trailingZeros(c *big.Int) int {
	if c.Bit(0) == 1 {
		return 0
	}
	if c.IsUint64() {
		n, u := 0, c.Uint64()
		for u != 0 && u%10 == 0 {
			u /= 10
			n++
		}
		return n
	}
	n := 0
	q, r := new(big.Int).Set(c), new(big.Int)
	for q.Sign() != 0 {
		q.QuoRem(q, bigTen, r)
		if r.Sign() != 0 {
			break
		}
		n++
	}
	return n
}

// decCompare compares the values of a and b (-1, 0, +1); zeros are equal whatever their sign.
func decCompare(a, b decimal) int {
	x, y, _ := aligned(a, b)
	return x.Cmp(y)
}

// roundSignificant rounds d to at most digits significant digits, half away from zero, and reports whether the
// value changed. A carry that adds a digit (9.99 to 10.0) is dropped into the exponent.
func (d decimal) roundSignificant(digits int) (decimal, bool) {
	n := len(d.digits())
	if d.isZero() || n <= digits {
		return d, false
	}
	r := d.roundAway(d.exp + n - digits)
	if len(r.digits()) > digits {
		r = decimal{neg: r.neg, coef: new(big.Int).Quo(r.coef, bigTen), exp: r.exp + 1}
	}
	return r, decCompare(r, d) != 0
}

// decQuotient is a / b (b not zero) with at most digits significant digits, half away from zero. exact reports
// that no digit was lost; an exact quotient is returned with the fewest digits (no trailing zeros).
func decQuotient(a, b decimal, digits int) (q decimal, exact bool) {
	neg := a.neg != b.neg
	if a.isZero() {
		return decimal{neg: neg, coef: new(big.Int)}, true
	}
	la, lb := len(a.digits()), len(b.digits())
	k := max(0, digits+1+lb-la)
	n := new(big.Int).Mul(a.coef, pow10(k))
	quo, rem := new(big.Int).QuoRem(n, b.coef, new(big.Int))
	exp := a.exp - b.exp - k
	if rem.Sign() == 0 {
		r := decimal{neg: neg, coef: quo, exp: exp}.normalized()
		r.neg = neg
		if len(r.digits()) <= digits {
			return r, true
		}
		r, _ = r.roundSignificant(digits)
		return r, false
	}
	// quo has at least digits+1 digits and a non-zero remainder follows: rounding at the digits-th digit sees the
	// remainder only as "more than nothing", which cannot turn a value below one half into one half or above
	r, _ := decimal{neg: neg, coef: quo, exp: exp}.roundSignificant(digits)
	return r, false
}

// decEuclid is the Euclidean division of the exact values: a = q * b + r with 0 <= r < |b|. b is not zero.
func decEuclid(a, b decimal) (q *big.Int, r decimal) {
	x, y, exp := aligned(a, b)
	q, m := new(big.Int).DivMod(x, y, new(big.Int))
	return q, fromSigned(m, exp, false)
}

// decimalFromBig is the integer v.
func decimalFromBig(v *big.Int) decimal { return fromSigned(new(big.Int).Set(v), 0, false) }
