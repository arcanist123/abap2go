package abap

// Arithmetic expressions: the calculation type table of docs/spec/calculation.md. An expression is a tree of
// operands, operators and functions; Calculate finds its calculation type from the types involved (the operands'
// and the result field's), converts every operand into it, calculates each operation in it (with its overflow,
// rounding and exception rules), and moves the result into the result field. Generic operands (TYPE any) carry the
// type they have at run time, so static and generic expressions go through the same rules.

import (
	"fmt"
	"math"
	"math/big"
)

// CalcType is the calculation type of an arithmetic expression, ordered by rank.
type CalcType uint8

const (
	CalcI CalcType = iota + 1
	CalcInt8
	CalcP
	CalcF
	CalcDecfloat34
)

func (c CalcType) String() string {
	switch c {
	case CalcI:
		return "i"
	case CalcInt8:
		return "int8"
	case CalcP:
		return "p"
	case CalcF:
		return "f"
	case CalcDecfloat34:
		return "decfloat34"
	}
	return fmt.Sprintf("CalcType(%d)", uint8(c))
}

// RankOf is the calculation type a data type involved in an expression asks for: text counts as p; d, t, x and
// xstring as i.
func RankOf(t Type) CalcType {
	switch t.Kind {
	case KindDecfloat16, KindDecfloat34:
		return CalcDecfloat34
	case KindF:
		return CalcF
	case KindP, KindC, KindN, KindString:
		return CalcP
	case KindInt8:
		return CalcInt8
	case KindUtclong:
		panic("abap: utclong cannot be an operand of an arithmetic expression")
	}
	return CalcI
}

// Op is a binary arithmetic operator.
type Op uint8

const (
	OpAdd      Op = iota + 1 // +
	OpSubtract               // -
	OpMultiply               // *
	OpDivide                 // /
	OpDiv                    // DIV
	OpMod                    // MOD
	OpPower                  // **
)

// Expr is an arithmetic expression.
type Expr interface {
	scan(s *scanState)
	eval(c *calc) num
}

// Operand is a data object or literal of type t holding v (in its Go representation).
func Operand(t Type, v any) Expr { return operand{t: t, v: textOperand(t, v)} }

// GenericOperand is a field symbol or parameter of a generic type, holding v of type t at run time. It counts like
// Operand, except that an inline declaration then declares decfloat34.
func GenericOperand(t Type, v any) Expr { return operand{t: t, v: textOperand(t, v), generic: true} }

// textOperand is a text operand as UTF-8: the calculation reads it as a number (see text.go).
func textOperand(t Type, v any) any {
	if isText(t.Kind) {
		return ToUTF8(v.(string))
	}
	return v
}

// Binary is l op r.
func Binary(op Op, l, r Expr) Expr {
	if op == OpPower {
		return power{l: l, r: r}
	}
	return binary{op: op, l: l, r: r}
}

// Negate is - x.
func Negate(x Expr) Expr { return unary{fn: fnNegate, x: x} }

// Abs is abs( x ).
func Abs(x Expr) Expr { return unary{fn: fnAbs, x: x} }

// Sqrt is sqrt( x ), a floating point function.
func Sqrt(x Expr) Expr { return unary{fn: fnSqrt, x: x} }

// Ipow is ipow( base = base exp = exp ). The exponent does not count for the calculation type; it is calculated on
// its own and converted to i.
func Ipow(base, exp Expr) Expr { return ipow{base: base, exp: exp} }

// Calculate is result = e. for a result field of type dst: the value to store in it.
func Calculate(e Expr, dst Type) (any, error) { return textResult(dst)(calculate(e, dst, false)) }

// CalculateExact is EXACT dst( e ): as Calculate, but any rounding raises CX_SY_CONVERSION_ROUNDING.
func CalculateExact(e Expr, dst Type) (any, error) { return textResult(dst)(calculate(e, dst, true)) }

// textResult turns a result for a text field into ABAP text; the calculation writes UTF-8 (see text.go).
func textResult(dst Type) func(r any, err error) (any, error) {
	return func(r any, err error) (any, error) {
		if r != nil && isText(dst.Kind) {
			return FromUTF8(r.(string)), err
		}
		return r, err
	}
}

// MustCalculate is Calculate for generated code: an error panics.
func MustCalculate[T any](e Expr, dst Type) T {
	r, err := Calculate(e, dst)
	if err != nil {
		panic(err)
	}
	return r.(T)
}

// CalculationType is the calculation type of e with a result field of type dst.
func CalculationType(e Expr, dst Type) CalcType {
	var s scanState
	e.scan(&s)
	s.add(dst, false)
	return s.calcType()
}

// DeclaredType is the type DATA(result) = e. declares: the calculation type of the operands alone, p as
// p LENGTH 8 DECIMALS 0, decfloat16 when that is the only decimal floating point type involved, and decfloat34 when
// an operand is generic.
func DeclaredType(e Expr) Type {
	var s scanState
	e.scan(&s)
	return s.declared()
}

// CalculateInline is DATA(result) = e.: the declared type and the value.
func CalculateInline(e Expr) (Type, any, error) {
	var s scanState
	e.scan(&s)
	t := s.declared()
	n, err := evaluate(e, s.calcType(), false)
	if err != nil {
		return t, nil, err
	}
	r, err := moveResult(s.calcType(), n, t)
	return t, r, err
}

func calculate(e Expr, dst Type, exact bool) (any, error) {
	var s scanState
	e.scan(&s)
	s.add(dst, false)
	ct := s.calcType()
	n, err := evaluate(e, ct, exact)
	if err != nil {
		return nil, err
	}
	r, err := moveResult(ct, n, dst)
	if err != nil && exact {
		return nil, err // EXACT keeps the result field
	}
	if err == nil && exact {
		if want, ok := resultDecimal(ct, n); ok {
			if got, ok := numericDecimal(dst, r); ok && decCompare(got, want) != 0 {
				return nil, errRounding
			}
		}
	}
	return r, err
}

// scanState collects the types involved in an expression.
type scanState struct {
	rank    CalcType
	float   bool // ** or a floating point function
	df16    bool
	df34    bool
	generic bool
}

func (s *scanState) add(t Type, generic bool) {
	s.rank = max(s.rank, RankOf(t))
	switch t.Kind {
	case KindDecfloat16:
		s.df16 = true
	case KindDecfloat34:
		s.df34 = true
	}
	s.generic = s.generic || generic
}

func (s *scanState) calcType() CalcType {
	r := max(s.rank, CalcI)
	if s.float && r < CalcF {
		r = CalcF
	}
	return r
}

func (s *scanState) declared() Type {
	if s.generic {
		return TypeDecfloat34
	}
	switch s.calcType() {
	case CalcI:
		return TypeI
	case CalcInt8:
		return TypeInt8
	case CalcP:
		return TypeP(8, 0)
	case CalcF:
		return TypeF
	}
	if s.df16 && !s.df34 {
		return TypeDecfloat16
	}
	return TypeDecfloat34
}

// num is a value in the calculation type: i and int8 in i, f in f, p and decfloat34 in d.
type num struct {
	i int64
	f float64
	d decimal
}

// calc is one evaluation: the calculation type, the precision of p (31 significant digits, or 63 once an interim
// result needs more than 31 digits before the point) and whether rounding is an error (EXACT).
type calc struct {
	ct     CalcType
	digits int
	exact  bool
}

// needMoreDigits restarts a p calculation with 63 digits.
type needMoreDigits struct{}

func evaluate(e Expr, ct CalcType, exact bool) (num, error) {
	c := &calc{ct: ct, digits: 31, exact: exact}
	for {
		n, err, retry := c.run(e)
		if !retry {
			return n, err
		}
		c.digits = 63
	}
}

func (c *calc) run(e Expr) (n num, err error, retry bool) {
	defer func() {
		if r := recover(); r != nil {
			switch x := r.(type) {
			case needMoreDigits:
				retry = true
			case *Exception:
				err = x
			case *RuntimeError:
				err = x
			default:
				panic(r)
			}
		}
	}()
	return e.eval(c), nil, false
}

func raise(e error) { panic(e) }

// moveResult moves a result of the calculation type into the result field.
func moveResult(ct CalcType, n num, dst Type) (any, error) {
	switch ct {
	case CalcI:
		return fromInteger(n.i, false, dst)
	case CalcInt8:
		if dst.Kind == KindI && (n.i < math.MinInt32 || n.i > math.MaxInt32) {
			// unlike the conversion of an int8 data object, which leaves the lower four bytes, an i result field
			// keeps its value; b and s are left with their lower bytes as by the conversion
			return nil, errOverflow
		}
		return fromInteger(n.i, true, dst)
	case CalcF:
		if dst.Kind == KindInt8 {
			// unlike the conversion of an f data object (its 17-digit form), the exact value, rounded
			v, ok := exactFloat(n.f).int64()
			if !ok {
				return nil, errOverflow
			}
			return v, nil
		}
		return fromFloat(n.f, dst)
	case CalcDecfloat34:
		return fromDecfloat(n.d, dst)
	}
	return pResult(n.d, dst)
}

// resultDecimal is the exact value of a result, for EXACT.
func resultDecimal(ct CalcType, n num) (decimal, bool) {
	switch ct {
	case CalcI, CalcInt8:
		return decimalFromInt64(n.i), true
	case CalcF:
		return exactFloat(n.f), true
	}
	return n.d, true
}

// numericDecimal is the exact value of a numeric data object.
func numericDecimal(t Type, v any) (decimal, bool) {
	switch t.Kind {
	case KindI:
		return decimalFromInt64(int64(v.(int32))), true
	case KindInt8:
		return decimalFromInt64(v.(int64)), true
	case KindB:
		return decimalFromInt64(int64(v.(uint8))), true
	case KindS:
		return decimalFromInt64(int64(v.(int16))), true
	case KindP:
		return v.(Packed).decimal(t.Decimals), true
	case KindF:
		return exactFloat(v.(float64)), true
	case KindDecfloat16, KindDecfloat34:
		return v.(Decfloat).decimal(), true
	}
	return decimal{}, false
}

// --- operands

type operand struct {
	t       Type
	v       any
	generic bool
}

func (o operand) scan(s *scanState) { s.add(o.t, o.generic) }

func (o operand) eval(c *calc) num {
	switch c.ct {
	case CalcI:
		return num{i: int64(mustConvert(o.t, o.v, TypeI).(int32))}
	case CalcInt8:
		return num{i: mustConvert(o.t, o.v, TypeInt8).(int64)}
	case CalcF:
		return num{f: mustConvert(o.t, o.v, TypeF).(float64)}
	case CalcDecfloat34:
		return num{d: mustConvert(o.t, o.v, TypeDecfloat34).(Decfloat).decimal()}
	}
	return num{d: pOperand(o.t, o.v)}
}

func mustConvert(src Type, v any, dst Type) any {
	r, err := convert8(src, v, dst)
	if err != nil {
		raise(err)
	}
	return r
}

// pOperand is an operand of a p calculation as an exact decimal with its scale: text read as a number, d and t as
// their day and second counts, x and xstring as an i.
func pOperand(t Type, v any) decimal {
	switch t.Kind {
	case KindC, KindN, KindString:
		d, ok := parseNumber(v.(string), false)
		if !ok {
			raise(errNoNumber)
		}
		return d
	case KindP:
		return v.(Packed).decimal(t.Decimals)
	case KindInt8:
		return decimalFromInt64(v.(int64))
	}
	return decimalFromInt64(int64(mustConvert(t, v, TypeI).(int32)))
}

// --- operators

type binary struct {
	op   Op
	l, r Expr
}

func (b binary) scan(s *scanState) { b.l.scan(s); b.r.scan(s) }

func (b binary) eval(c *calc) num {
	x, y := b.l.eval(c), b.r.eval(c)
	switch c.ct {
	case CalcI, CalcInt8:
		return num{i: c.intOp(b.op, x.i, y.i)}
	case CalcF:
		return num{f: c.floatOp(b.op, x.f, y.f)}
	case CalcDecfloat34:
		return num{d: c.dfOp(b.op, x.d, y.d)}
	}
	return num{d: c.pOp(b.op, x.d, y.d)}
}

type power struct{ l, r Expr }

func (p power) scan(s *scanState) { p.l.scan(s); p.r.scan(s); s.float = true }

func (p power) eval(c *calc) num {
	x, y := p.l.eval(c), p.r.eval(c)
	if c.ct == CalcDecfloat34 {
		return num{d: c.dfPow(x.d, y.d)}
	}
	return num{f: c.floatPow(x.f, y.f)}
}

type unaryFn uint8

const (
	fnNegate unaryFn = iota + 1
	fnAbs
	fnSqrt
)

type unary struct {
	fn unaryFn
	x  Expr
}

func (u unary) scan(s *scanState) {
	u.x.scan(s)
	if u.fn == fnSqrt {
		s.float = true
	}
}

func (u unary) eval(c *calc) num {
	x := u.x.eval(c)
	switch c.ct {
	case CalcI, CalcInt8:
		if u.fn == fnAbs && x.i >= 0 {
			return x
		}
		return num{i: c.intOp(OpSubtract, 0, x.i)}
	case CalcF:
		switch u.fn {
		case fnNegate:
			return num{f: 0 - x.f}
		case fnAbs:
			return num{f: math.Abs(x.f)}
		}
		if x.f < 0 {
			raise(errArgOutOfDomain)
		}
		return num{f: math.Sqrt(x.f)}
	case CalcDecfloat34:
		switch u.fn {
		case fnNegate:
			return num{d: x.d.negated()}
		case fnAbs:
			return num{d: x.d.abs()}
		}
		return num{d: c.dfSqrt(x.d)}
	}
	if u.fn == fnAbs {
		return num{d: x.d.abs()}
	}
	return num{d: c.pFit(x.d.negated())}
}

type ipow struct{ base, exp Expr }

func (p ipow) scan(s *scanState) { p.base.scan(s) }

func (p ipow) eval(c *calc) num {
	base := p.base.eval(c)
	r, err := Calculate(p.exp, TypeI)
	if err != nil {
		raise(err)
	}
	n := int64(r.(int32))
	if n == 0 {
		return c.one()
	}
	if n < 0 && c.isZero(base) {
		raise(errArithmeticOverflow)
	}
	if c.ct == CalcP && base.d.isZero() {
		return base // with its decimals: ipow( 0.00, 2 ) is 0.00
	}
	k := n
	if k < 0 {
		k = -k
	}
	v := base
	if c.settled(base) {
		v = c.settledPower(base, k)
	} else if c.ct == CalcP {
		// square and multiply from a 1 without decimals, which decides the scale of the power (pProduct):
		// ipow( 2.00, 1 ) is 1 * 2.00 = 2.000, ipow( 2.00, 3 ) is 2.000 * 4.000 = 8.0
		v = c.one()
		for sq := base; ; {
			if k&1 == 1 {
				v = c.op(OpMultiply, v, sq)
			}
			if k >>= 1; k == 0 {
				break
			}
			sq = c.op(OpMultiply, sq, sq)
		}
	} else {
		for i := int64(1); i < k; i++ {
			v = c.op(OpMultiply, v, base)
		}
	}
	if n < 0 {
		v = c.op(OpDivide, c.one(), v)
	}
	return v
}

// op is one binary operation in the calculation type.
func (c *calc) op(op Op, x, y num) num {
	switch c.ct {
	case CalcI, CalcInt8:
		return num{i: c.intOp(op, x.i, y.i)}
	case CalcF:
		return num{f: c.floatOp(op, x.f, y.f)}
	case CalcDecfloat34:
		return num{d: c.dfOp(op, x.d, y.d)}
	}
	return num{d: c.pOp(op, x.d, y.d)}
}

func (c *calc) one() num {
	switch c.ct {
	case CalcI, CalcInt8:
		return num{i: 1}
	case CalcF:
		return num{f: 1}
	}
	return num{d: decimalFromInt64(1)}
}

func (c *calc) isZero(x num) bool {
	switch c.ct {
	case CalcI, CalcInt8:
		return x.i == 0
	case CalcF:
		return x.f == 0
	}
	return x.d.isZero()
}

// settled reports that the power of base is known without multiplying: base is 0, 1 or -1 in an integer
// calculation (the loop would otherwise run up to 2^31 times).
func (c *calc) settled(base num) bool {
	if c.ct != CalcI && c.ct != CalcInt8 {
		return false
	}
	return base.i == 0 || base.i == 1 || base.i == -1
}

func (c *calc) settledPower(base num, k int64) num {
	if base.i == -1 && k%2 == 1 {
		return num{i: -1}
	}
	if base.i == 0 {
		return num{i: 0}
	}
	return num{i: 1}
}

// --- i and int8

func (c *calc) intRange() (lo, hi int64) {
	if c.ct == CalcI {
		return math.MinInt32, math.MaxInt32
	}
	return math.MinInt64, math.MaxInt64
}

func (c *calc) intOp(op Op, a, b int64) int64 {
	switch op {
	case OpDivide, OpDiv, OpMod:
		if a == 0 {
			return 0
		}
		if b == 0 {
			raise(errZerodivide)
		}
	}
	x, y := big.NewInt(a), big.NewInt(b)
	r := new(big.Int)
	switch op {
	case OpAdd:
		r.Add(x, y)
	case OpSubtract:
		r.Sub(x, y)
	case OpMultiply:
		r.Mul(x, y)
	case OpDivide:
		q, m := new(big.Int).QuoRem(x, y, new(big.Int))
		if m.Sign() != 0 {
			if c.exact {
				raise(errRounding)
			}
			if new(big.Int).Lsh(new(big.Int).Abs(m), 1).Cmp(new(big.Int).Abs(y)) >= 0 {
				if (a < 0) != (b < 0) {
					q.Sub(q, bigOne)
				} else {
					q.Add(q, bigOne)
				}
			}
		}
		r = q
	case OpDiv:
		r.Div(x, y)
	case OpMod:
		r.Mod(x, y)
	default:
		panic(fmt.Sprintf("abap: operator %d in an integer calculation", op))
	}
	lo, hi := c.intRange()
	if !r.IsInt64() || r.Int64() < lo || r.Int64() > hi {
		raise(errArithmeticOverflow)
	}
	return r.Int64()
}

// --- f

func (c *calc) floatOp(op Op, a, b float64) float64 {
	var r float64
	switch op {
	case OpAdd:
		r = a + b
	case OpSubtract:
		r = a - b
	case OpMultiply:
		r = a * b
	case OpDivide, OpDiv, OpMod:
		if a == 0 {
			return 0
		}
		if b == 0 {
			raise(errZerodivide)
		}
		q := a / b
		switch op {
		case OpDivide:
			r = q
		case OpDiv:
			if math.IsInf(q, 0) {
				raise(errArithmeticOverflow)
			}
			r = euclidQuotient(q, b)
		case OpMod:
			if math.IsInf(q, 0) {
				if q > 0 {
					return 0
				}
				raise(errArithmeticOverflow)
			}
			r = a - b*euclidQuotient(q, b)
		}
	default:
		panic(fmt.Sprintf("abap: operator %d in an f calculation", op))
	}
	if math.IsInf(r, 0) || math.IsNaN(r) {
		raise(errArithmeticOverflow)
	}
	return r
}

// euclidQuotient rounds the quotient q = a / b to the integer of the Euclidean division: down for a positive b, up
// for a negative one.
func euclidQuotient(q, b float64) float64 {
	if b > 0 {
		return math.Floor(q)
	}
	return math.Ceil(q)
}

func (c *calc) floatPow(a, b float64) float64 {
	if b == 0 {
		return 1
	}
	if a == 0 {
		if b < 0 {
			raise(errArithmeticOverflow)
		}
		return 0
	}
	if a < 0 && b != math.Trunc(b) {
		raise(errArgOutOfDomain)
	}
	r := math.Pow(a, b)
	if math.IsInf(r, 0) || math.IsNaN(r) {
		raise(errArithmeticOverflow)
	}
	return r
}

// --- p

// pFit checks an interim result of a p calculation: more digits before the point than the precision restarts the
// calculation with 63 digits or, at 63, overflows; otherwise it is rounded to the precision. Zero has no sign and
// no decimals.
func (c *calc) pFit(d decimal) decimal {
	if d.isZero() {
		return decimal{coef: new(big.Int)}
	}
	r, rounded := d.roundSignificant(c.digits)
	if rounded && c.exact {
		raise(errRounding)
	}
	if r.integerDigits() > c.digits {
		if c.digits == 31 {
			panic(needMoreDigits{})
		}
		raise(errArithmeticOverflow)
	}
	return r
}

func (c *calc) pOp(op Op, a, b decimal) decimal {
	switch op {
	case OpAdd:
		return c.pFit(decSum(a, b))
	case OpSubtract:
		return c.pFit(decSum(a, b.negated()))
	case OpMultiply:
		return c.pFit(pProduct(a, b))
	}
	if a.isZero() {
		return decimal{coef: new(big.Int)}
	}
	if b.isZero() {
		raise(errZerodivide)
	}
	switch op {
	case OpDivide:
		q, exact := decQuotient(a, b, c.digits)
		if !exact && c.exact {
			raise(errRounding)
		}
		return c.pFit(integral(q))
	case OpDiv:
		q, _ := decEuclid(a, b)
		return c.pFit(decimalFromBig(q))
	case OpMod:
		_, r := decEuclid(a, b)
		return c.pFit(integral(r.normalized()))
	}
	panic(fmt.Sprintf("abap: operator %d in a p calculation", op))
}

// integral is d with the zeros before the decimal point in its coefficient: a quotient or remainder of a p
// calculation drops only the trailing zeros of its decimals (600 / 6 is 100, not 1E2), which a product counts
// (pProduct).
func integral(d decimal) decimal {
	if d.exp <= 0 {
		return d
	}
	return decimal{neg: d.neg, coef: new(big.Int).Mul(d.coef, pow10(d.exp))}
}

// pResult moves the result of a p calculation into its result field. A result that does not fit raises
// CX_SY_ARITHMETIC_OVERFLOW instead of the conversion's CX_SY_CONVERSION_OVERFLOW; c and string get their own
// text (pToC, pToString).
func pResult(d decimal, dst Type) (any, error) {
	switch dst.Kind {
	case KindString:
		return pToString(d)
	case KindC:
		return pToC(d, dst.Length)
	}
	r, err := fromPacked(d, dst)
	if err == errOverflow {
		err = errArithmeticOverflow
	}
	return r, err
}

// pTextLimit is the number of decimals a p result keeps for a text target: at most 14, and at most 31 digits in
// all. More than 31 digits before the point overflow.
func pTextLimit(d decimal) (int, error) {
	n := d.integerDigits()
	if n > 31 {
		return 0, errArithmeticOverflow
	}
	return min(14, 31-n), nil
}

// pToString is a p result in a string: rounded to the decimals it keeps (losing the sign if that gives zero), with
// its scale and the sign character after it.
func pToString(d decimal) (any, error) {
	limit, err := pTextLimit(d)
	if err != nil {
		return nil, err
	}
	if -d.exp > limit {
		d = d.roundAway(-limit)
		if d.isZero() {
			d.neg = false
		}
	}
	return numberToString(d), nil
}

// pToC is a p result in c LENGTH n: trailing zeros of the decimals dropped, then decimals rounded off one by one
// until the number fits, right-aligned with its sign character; a negative number rounded to zero keeps its sign.
// A result with more decimals than a text keeps is first rounded to the decimals the field can show at all (n - 2),
// and loses its sign if that gives zero. If no decimals are left and it still does not fit, the field gets * and
// the end of the number.
func pToC(d decimal, n int) (any, error) {
	limit, err := pTextLimit(d)
	if err != nil {
		return nil, err
	}
	if -d.exp > limit {
		d = d.roundAway(-min(limit, max(0, n-2)))
		if d.isZero() {
			d.neg = false
		}
	}
	d = d.withoutTrailingZeros()
	for {
		if s, ok := placeSigned(d, n); ok {
			return s, nil
		}
		if d.exp >= 0 {
			break
		}
		d = d.roundAway(d.exp + 1).withoutTrailingZeros()
	}
	text := d.abs().plain()
	if d.neg {
		if text == "0" {
			return fitRight("-", n, " "), nil
		}
		text += "-"
	}
	return "*" + text[len(text)-(n-1):], nil
}

// placeSigned places a number right-aligned in n characters with its sign character ('-', also for a negative
// zero, or a blank that a positive number may drop).
func placeSigned(d decimal, n int) (string, bool) {
	text := d.abs().plain()
	if d.neg {
		text += "-"
	} else if len(text)+1 <= n {
		text += " "
	}
	if len(text) > n {
		return "", false
	}
	return fitRight(text, n, " "), true
}

// --- decfloat34

// dfFit rounds an interim result into decfloat34: too large overflows, too small becomes zero.
func (c *calc) dfFit(d decimal) decimal {
	v, ok := decfloat34Format.toDecfloat(d)
	if !ok {
		raise(errArithmeticOverflow)
	}
	r := v.decimal()
	if c.exact && decCompare(r, d) != 0 {
		raise(errRounding)
	}
	return r
}

func (c *calc) dfOp(op Op, a, b decimal) decimal {
	switch op {
	case OpAdd:
		return c.dfFit(decSum(a, b))
	case OpSubtract:
		return c.dfFit(decSum(a, b.negated()))
	case OpMultiply:
		return c.dfFit(decProduct(a, b))
	}
	if a.isZero() {
		return decimal{coef: new(big.Int)}
	}
	if b.isZero() {
		raise(errZerodivide)
	}
	switch op {
	case OpDivide:
		return c.dfDivide(a, b)
	case OpDiv:
		return c.dfDiv(a, b)
	case OpMod:
		q := c.dfDiv(a, b)
		return c.dfFit(decSum(a, c.dfFit(decProduct(b, q)).negated()))
	}
	panic(fmt.Sprintf("abap: operator %d in a decfloat34 calculation", op))
}

// dfDivide is a / b in decfloat34: an exact quotient takes the exponent closest to that of a minus that of b, an
// inexact one has 34 digits.
func (c *calc) dfDivide(a, b decimal) decimal {
	q, exact := decQuotient(a, b, 34)
	if !exact {
		if c.exact {
			raise(errRounding)
		}
		return c.dfFit(q)
	}
	ideal := a.exp - b.exp
	if q.exp > ideal {
		s := min(q.exp-ideal, 34-len(q.digits()))
		q = decimal{neg: q.neg, coef: new(big.Int).Mul(q.coef, pow10(s)), exp: q.exp - s}
	}
	return c.dfFit(q)
}

// dfDiv is a DIV b in decfloat34: the quotient a / b rounded to an integer towards the Euclidean quotient, with
// exponent 0 unless the quotient has a larger one.
func (c *calc) dfDiv(a, b decimal) decimal {
	q := c.dfDivide(a, b)
	if q.exp >= 0 {
		return q
	}
	t, m := new(big.Int).QuoRem(q.coef, pow10(-q.exp), new(big.Int))
	if m.Sign() != 0 && q.neg != b.neg {
		// a negative quotient goes down for a positive b, a positive one up for a negative b
		t.Add(t, bigOne)
	}
	return c.dfFit(decimal{neg: q.neg, coef: t, exp: 0})
}

func (c *calc) dfPow(a, b decimal) decimal {
	if b.isZero() {
		return decimalFromInt64(1)
	}
	if a.isZero() {
		if b.neg {
			raise(errArgOutOfDomain)
		}
		return decimal{coef: new(big.Int)}
	}
	bn := b.normalized()
	integer := bn.exp >= 0
	if a.neg && !integer {
		raise(errArgOutOfDomain)
	}
	if integer && bn.adjusted() < 6 {
		n := bn.integer()
		k := new(big.Int).Abs(n).Int64()
		if k*int64(len(a.digits())) <= 50000 {
			p := decimal{
				neg:  a.neg && k%2 == 1,
				coef: new(big.Int).Exp(a.coef, big.NewInt(k), nil),
				exp:  a.exp * int(k),
			}
			if n.Sign() > 0 {
				return c.dfFit(p)
			}
			return c.dfDivide(decimalFromInt64(1), c.dfFit(p))
		}
	}
	r := powReal(a.abs(), b, 34)
	if a.neg && integer && bn.integer().Bit(0) == 1 {
		r.neg = true
	}
	return c.dfFit(r)
}

// dfSqrt is sqrt( a ) in decfloat34: an exact root has half the exponent of a (rounded down), an inexact one 34
// digits.
func (c *calc) dfSqrt(a decimal) decimal {
	ideal := a.exp >> 1 // rounds down, also for negative exponents
	if a.isZero() {
		return decimal{neg: a.neg, coef: new(big.Int), exp: ideal}
	}
	if a.neg {
		raise(errArgOutOfDomain)
	}
	m := new(big.Int).Mul(a.coef, pow10(a.exp-2*ideal))
	s := new(big.Int).Sqrt(m)
	if new(big.Int).Mul(s, s).Cmp(m) == 0 {
		return c.dfFit(decimal{coef: s, exp: ideal})
	}
	k := max(0, 40-len(m.String())/2)
	s = new(big.Int).Sqrt(new(big.Int).Mul(m, pow10(2*k)))
	r, _ := decimal{coef: s, exp: ideal - k}.roundSignificant(34)
	if c.exact {
		raise(errRounding)
	}
	return c.dfFit(r)
}
