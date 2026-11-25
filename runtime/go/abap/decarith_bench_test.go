package abap

import (
	"math/big"
	"testing"
)

func TestTrailingZeros(t *testing.T) {
	for _, tc := range []struct {
		coef string
		want int
	}{
		{"0", 0},
		{"1", 0},
		{"10", 1},
		{"2000", 3},
		{"12345", 0},
		{"18446744073709551610", 1}, // above math.MaxInt64, still a uint64
		{"18446744073709551620", 1}, // just above math.MaxUint64
		{"1000000000000000000000000000000", 30},
		{"12345678901234567890000", 4},
	} {
		c, _ := new(big.Int).SetString(tc.coef, 10)
		if got := trailingZeros(c); got != tc.want {
			t.Errorf("trailingZeros(%s) = %d, want %d", tc.coef, got, tc.want)
		}
	}
}

func benchDecimal(s string) decimal { return parseDecimalDigits(false, s, 0) }

var benchSink decimal

// BenchmarkPMultiply is one multiplication of a p calculation: the product, its scale and the fit to 31 digits.
func BenchmarkPMultiply(b *testing.B) {
	for _, bc := range []struct {
		name string
		a, b decimal
	}{
		{"2.00*2.00", benchDecimal("2.00"), benchDecimal("2.00")},
		{"123.45*1.19", benchDecimal("123.45"), benchDecimal("1.19")},
		{"1000000.00*100", benchDecimal("1000000.00"), benchDecimal("100")},
		{"31digits", benchDecimal("12345678901234567.89012345678901"), benchDecimal("9876.54321098765432")},
	} {
		b.Run(bc.name, func(b *testing.B) {
			c := &calc{ct: CalcP, digits: 31}
			b.ReportAllocs()
			for b.Loop() {
				benchSink = c.pOp(OpMultiply, bc.a, bc.b)
			}
		})
	}
}

// BenchmarkPCalculate is a whole statement r = e. with a result field r of type p LENGTH 16 DECIMALS 2.
func BenchmarkPCalculate(b *testing.B) {
	p := func(length, decimals int, v string) Expr {
		t := TypeP(length, decimals)
		x, err := cellValue(t, v)
		if err != nil {
			b.Fatal(err)
		}
		return Operand(t, x)
	}
	i := func(v int32) Expr { return Operand(TypeI, v) }
	for _, bc := range []struct {
		name string
		e    Expr
	}{
		{"r=a", p(8, 2, "2.00")},
		{"2.00*2.00", Binary(OpMultiply, p(8, 2, "2.00"), p(8, 2, "2.00"))},
		{"123.45*1.19", Binary(OpMultiply, p(8, 2, "123.45"), p(8, 2, "1.19"))},
		{"1000000.00*100", Binary(OpMultiply, p(8, 2, "1000000.00"), i(100))},
		{"31digits", Binary(OpMultiply, p(16, 14, "12345678901234567.89012345678901"), p(16, 14, "9876.54321098765432"))},
		{"ipow1.10^3", Ipow(p(8, 2, "1.10"), i(3))},
		{"ipow1.01^50", Ipow(p(8, 2, "1.01"), i(50))},
		{"ipow1^100000", Ipow(p(8, 0, "1"), i(100000))},
		{"ipow1.00^100000", Ipow(p(8, 2, "1.00"), i(100000))},
	} {
		b.Run(bc.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				if _, err := Calculate(bc.e, TypeP(16, 2)); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
