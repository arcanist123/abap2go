package abap

import "fmt"

// Built-in functions as operands of a comparison of data objects (docs/spec/comparison.md, "Built-in functions as
// operands"): a function of a single data object, outside an arithmetic expression, is a value of the type of its
// result, which the argument decides.

// ValueOf is the type and value of f: abs( x ) or sqrt( x ) of a data object x, calculated in the calculation type
// of x alone, or strlen( x ) as Strlen gives it. The error is an *Exception or a *RuntimeError.
func ValueOf(f Expr) (Type, any, error) {
	if x, ok := f.(operand); ok {
		return x.t, x.v, nil // strlen( ) is an i already
	}
	arg := f.(unary).x.(operand)
	ct := calculationTypeOf(f)
	n, err := evaluate(f, ct, false)
	if err != nil {
		return Type{}, nil, err
	}
	switch ct {
	case CalcI:
		return TypeI, int32(n.i), nil
	case CalcInt8:
		return TypeInt8, n.i, nil
	case CalcF:
		return TypeF, n.f, nil
	case CalcDecfloat34:
		v, err := fromDecfloat(n.d, TypeDecfloat34)
		return TypeDecfloat34, v, err
	}
	return packedValue(arg.t, n.d)
}

// MustValueOf is ValueOf for generated code: an error panics.
func MustValueOf(f Expr) (Type, any) {
	t, v, err := ValueOf(f)
	if err != nil {
		panic(err)
	}
	return t, v
}

// packedValue types a result of calculation type p. A p argument keeps its type. For a text argument (c, n, string)
// the result is a p with the decimals of the number the text holds, as far as 31 digits in all leave room for them;
// the digits before the point count as at least one. Beyond 31 digits it raises CX_SY_CONVERSION_OVERFLOW, and more
// than the 14 decimals a p can have end the program.
func packedValue(arg Type, d decimal) (Type, any, error) {
	t := arg
	if arg.Kind != KindP {
		decimals := max(0, -d.exp)
		if room := 31 - max(1, d.integerDigits()); decimals > room {
			if room < 0 {
				return Type{}, nil, errOverflow
			}
			decimals = room
			d = d.roundAway(-decimals)
			if d.integerDigits()+decimals > 31 {
				return Type{}, nil, errOverflow // the rounding carried into one more digit
			}
		}
		if decimals > 14 {
			return Type{}, nil, &RuntimeError{Name: "SYSTEM_TYPE_NOT_ELEMENTARY",
				Text: fmt.Sprintf("a p with %d decimals is not a valid type", decimals)}
		}
		t = TypeP(16, decimals)
	}
	v, err := fromPacked(d, t)
	return t, v, err
}
