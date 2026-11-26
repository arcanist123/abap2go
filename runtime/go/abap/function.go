package abap

import "fmt"

// Values calculated for a comparison of data objects. A built-in function of a single data object, outside an
// arithmetic expression, is a value of the type of its result, which the argument decides (docs/spec/comparison.md,
// "Built-in functions as operands"). An arithmetic expression after CASE is calculated on its own (there, "CASE").

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
	if ct == CalcP {
		return packedValue(arg.t, n.d)
	}
	return valueOfType(ct, n)
}

// CaseValue is the type and value of e, an arithmetic expression as the operand of CASE, calculated in the
// calculation type of its own operands. A p has the decimals the result would have in a string. The error is an
// *Exception.
func CaseValue(e Expr) (Type, any, error) {
	ct := calculationTypeOf(e)
	n, err := evaluate(e, ct, false)
	if err != nil {
		return Type{}, nil, err
	}
	if ct != CalcP {
		return valueOfType(ct, n)
	}
	d, err := pRounded(n.d)
	if err != nil {
		return Type{}, nil, err
	}
	t := TypeP(16, max(0, -d.exp))
	v, err := fromPacked(d, t)
	return t, v, err
}

// MustCaseValue is CaseValue for generated code: an exception panics.
func MustCaseValue(e Expr) (Type, any) {
	t, v, err := CaseValue(e)
	if err != nil {
		panic(err)
	}
	return t, v
}

// valueOfType is a result of a calculation type other than p as a data object of that type.
func valueOfType(ct CalcType, n num) (Type, any, error) {
	switch ct {
	case CalcI:
		return TypeI, int32(n.i), nil
	case CalcInt8:
		return TypeInt8, n.i, nil
	case CalcF:
		return TypeF, n.f, nil
	}
	v, err := fromDecfloat(n.d, TypeDecfloat34)
	return TypeDecfloat34, v, err
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
