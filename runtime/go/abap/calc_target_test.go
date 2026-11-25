package abap

import (
	"errors"
	"testing"
)

// The value a result field is left with after an exception (docs/spec/conversion.md, "The target after an
// exception"): Calculate returns it with the exception, nil when the field keeps its value.
func TestResultFieldAfterException(t *testing.T) {
	i := func(v int32) Expr { return Operand(TypeI, v) }
	p0 := Operand(TypeP(8, 0), MustConvert[Packed](TypeString, FromUTF8("0"), TypeP(8, 0)))
	f := func(v float64) Expr { return Operand(TypeF, v) }
	cases := []struct {
		name  string
		calc  func() (any, error)
		class string
		want  any // nil: the field keeps its value
	}{
		{"b = i 300", func() (any, error) { return Calculate(i(300), TypeB) }, CxConversionOverflow, uint8(44)},
		{"b = 5 + i 300", func() (any, error) { return Calculate(Binary(OpAdd, Operand(TypeB, uint8(5)), i(300)), TypeB) },
			CxConversionOverflow, uint8(49)},
		{"b = i 300 + p 0", func() (any, error) { return Calculate(Binary(OpAdd, i(300), p0), TypeB) },
			CxArithmeticOverflow, uint8(44)},
		{"s = i 40000", func() (any, error) { return Calculate(i(40000), TypeS) }, CxConversionOverflow, int16(-25536)},
		{"s = f 123456.789", func() (any, error) { return Calculate(f(123456.789), TypeS) }, CxConversionOverflow, int16(-7615)},
		{"b = f 1E10", func() (any, error) { return Calculate(f(1e10), TypeB) }, CxConversionOverflow, uint8(0)},
		{"i = f 1E10", func() (any, error) { return Calculate(f(1e10), TypeI) }, CxConversionOverflow, nil},
		{"p3.1 = i 30000 + p 0", func() (any, error) { return Calculate(Binary(OpAdd, i(30000), p0), TypeP(3, 1)) },
			CxArithmeticOverflow, nil},
		{"EXACT b( i 300 )", func() (any, error) { return CalculateExact(i(300), TypeB) }, CxConversionOverflow, nil},
		{"i = i max + 1", func() (any, error) { return Calculate(Binary(OpAdd, i(2147483647), i(1)), TypeI) },
			CxArithmeticOverflow, nil},
	}
	for _, c := range cases {
		r, err := c.calc()
		var exc *Exception
		if !errors.As(err, &exc) || exc.Class != c.class {
			t.Errorf("%s: got error %v, want %s", c.name, err, c.class)
			continue
		}
		if r != c.want {
			t.Errorf("%s: left %#v, want %#v", c.name, r, c.want)
		}
	}
}
