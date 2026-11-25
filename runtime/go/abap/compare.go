package abap

// The comparison rules for elementary data objects: the comparison table in docs/spec/comparison.md. Two operands
// are compared in their comparison type; an operand of another type is converted to it first. A conversion error
// in a comparison is a runtime error (CONVT_NO_NUMBER, CONVT_OVERFLOW), not a catchable exception, and two kinds
// without a comparison type end the program with COMPARE_NOT_SUPPORTED (a syntax error with static types).

import (
	"fmt"
	"strings"
)

// Compare compares a (type ta) with b (type tb): -1 if a < b, 0 if they are equal, +1 if a > b. The error is a
// *RuntimeError.
func Compare(ta Type, a any, tb Type, b any) (int, error) {
	ct, ok := ComparisonType(ta, tb)
	if !ok {
		return 0, &RuntimeError{Name: "COMPARE_NOT_SUPPORTED",
			Text: fmt.Sprintf(`Comparison of type "%s" and type "%s" not supported.`, kindTag(ta), kindTag(tb))}
	}
	if isText(ct.Kind) {
		// text against text, on code units
		if (ta.Kind == KindD || ta.Kind == KindT) && ta.Kind != tb.Kind {
			return compareDateTimeText(ta.Kind, a.(string), tb, b.(string)), nil
		}
		if (tb.Kind == KindD || tb.Kind == KindT) && ta.Kind != tb.Kind {
			return -compareDateTimeText(tb.Kind, b.(string), ta, a.(string)), nil
		}
		x, y := comparisonText(ta, a, ct), comparisonText(tb, b, ct)
		return compareText(x, y, ct.Kind), nil
	}
	// the other comparison types read text as numbers, dates and times, in UTF-8 (see text.go)
	if isText(ta.Kind) {
		a = ToUTF8(a.(string))
	}
	if isText(tb.Kind) {
		b = ToUTF8(b.(string))
	}
	switch ct.Kind {
	case KindI, KindInt8, KindP, KindDecfloat34:
		x, err := comparisonDecimal(ta, a, ct)
		if err != nil {
			return 0, err
		}
		y, err := comparisonDecimal(tb, b, ct)
		if err != nil {
			return 0, err
		}
		return decCompare(x, y), nil
	case KindF:
		x, err := comparisonFloat(ta, a)
		if err != nil {
			return 0, err
		}
		y, err := comparisonFloat(tb, b)
		if err != nil {
			return 0, err
		}
		return cmpFloat(x, y), nil
	case KindX, KindXString:
		x, y := a.(string), b.(string)
		if ct.Kind == KindX {
			n := max(len(x), len(y))
			x, y = fitBytesLeft(x, n), fitBytesLeft(y, n)
		}
		return strings.Compare(x, y), nil
	case KindUtclong:
		x, err := comparisonUtclong(ta, a)
		if err != nil {
			return 0, err
		}
		y, err := comparisonUtclong(tb, b)
		if err != nil {
			return 0, err
		}
		return cmpInt(int64(x), int64(y)), nil
	}
	panic(fmt.Sprintf("abap: no comparison in %v", ct))
}

// kindTag is the type name in the text of COMPARE_NOT_SUPPORTED.
func kindTag(t Type) string { return strings.ToUpper(t.Kind.String()) }

// family groups the kinds as the comparison type tables of the keyword documentation do.
type family uint8

const (
	famNumeric  family = iota
	famText            // c, string, n
	famBytes           // x, xstring
	famDateTime        // d, t
	famUtclong
)

func familyOf(k Kind) family {
	switch k {
	case KindC, KindString, KindN:
		return famText
	case KindX, KindXString:
		return famBytes
	case KindD, KindT:
		return famDateTime
	case KindUtclong:
		return famUtclong
	}
	return famNumeric
}

// numericRank orders the numeric kinds by the comparison type they impose: decfloat over f over p over int8 over i.
func numericRank(k Kind) int {
	switch k {
	case KindDecfloat16, KindDecfloat34:
		return 5
	case KindF:
		return 4
	case KindP:
		return 3
	case KindInt8:
		return 2
	case KindI, KindB, KindS:
		return 1
	}
	return 0
}

// ComparisonType is the type two operands of types ta and tb are compared in, false if they cannot be compared.
// For p the result has 31 digits and the larger number of decimals of the operands; the lengths of c, n and x are
// the larger length.
func ComparisonType(ta, tb Type) (Type, bool) {
	fa, fb := familyOf(ta.Kind), familyOf(tb.Kind)
	if fa == famUtclong || fb == famUtclong {
		other := tb.Kind
		if fb == famUtclong {
			other = ta.Kind
		}
		if other == KindUtclong || other == KindC || other == KindString {
			return TypeUtclong, true
		}
		return Type{}, false
	}
	// a numeric operand decides: the higher-ranked numeric kind of the two
	if fa == famNumeric || fb == famNumeric {
		r := max(numericRank(ta.Kind), numericRank(tb.Kind))
		switch r {
		case 5:
			return TypeDecfloat34, true
		case 4:
			return TypeF, true
		case 3:
			dec := 0
			if ta.Kind == KindP {
				dec = ta.Decimals
			}
			if tb.Kind == KindP {
				dec = max(dec, tb.Decimals)
			}
			return TypeP(16, dec), true
		case 2:
			return TypeInt8, true
		}
		return TypeI, true
	}
	ka, kb := ta.Kind, tb.Kind
	if ka > kb { // order the pair: c < n < d < t < string < x < xstring
		ta, tb, ka, kb = tb, ta, kb, ka
	}
	switch {
	case ka == KindD && kb == KindT:
		return Type{}, false
	case ka == kb && (ka == KindD || ka == KindT || ka == KindString || ka == KindXString):
		return ta, true
	case ka == kb: // c, n, x: the longer length
		return Type{Kind: ka, Length: max(ta.Length, tb.Length)}, true
	case ka == KindC && kb == KindN, ka == KindN && (kb == KindString || kb == KindX || kb == KindXString):
		return TypeP(16, 0), true
	case (ka == KindD || ka == KindT) && (kb == KindX || kb == KindXString):
		return TypeI, true
	case ka == KindC && (kb == KindD || kb == KindT):
		return TypeC(max(ta.Length, tb.textLength())), true
	case ka == KindN && (kb == KindD || kb == KindT):
		return TypeN(max(ta.Length, tb.textLength())), true
	case (ka == KindD || ka == KindT) && kb == KindString, ka == KindC && kb == KindString:
		return TypeString, true
	case ka == KindC && kb == KindX:
		return TypeC(max(ta.Length, 2*tb.Length)), true
	case ka == KindC && kb == KindXString, ka == KindString && (kb == KindX || kb == KindXString):
		return TypeString, true
	case ka == KindX && kb == KindXString:
		return TypeXString, true
	}
	panic(fmt.Sprintf("abap: no comparison type for %v and %v", ta, tb))
}

// conversionError turns the exception of a conversion into the runtime error it is in a comparison.
func conversionError(err error, text string) error {
	if e, ok := err.(*Exception); ok {
		switch e.Class {
		case CxConversionNoNumber:
			return &RuntimeError{Name: "CONVT_NO_NUMBER", Text: fmt.Sprintf(`"%s" cannot be interpreted as a number`, text)}
		case CxConversionOverflow:
			return &RuntimeError{Name: "CONVT_OVERFLOW", Text: fmt.Sprintf(`Overflow when converting %s`, text)}
		}
	}
	return err
}

// comparisonDecimal is the exact value of an operand in a numeric comparison type other than f.
func comparisonDecimal(t Type, v any, ct Type) (decimal, error) {
	if d, ok := numericDecimal(t, v); ok {
		if t.Kind == KindF && ct.Kind == KindDecfloat34 {
			r, err := convert8(t, v, TypeDecfloat34) // through the 17-digit form
			if err != nil {
				return decimal{}, err
			}
			return r.(Decfloat).decimal(), nil
		}
		return d, nil
	}
	switch t.Kind {
	case KindC, KindString, KindN:
		s := v.(string)
		switch ct.Kind {
		case KindI, KindInt8:
			// the value of the text, rounded to an integer, need not fit the comparison type
			d, ok := parseNumber(s, false)
			if !ok {
				return decimal{}, conversionError(errNoNumber, strings.TrimRight(s, " "))
			}
			return d.roundAway(0), nil
		case KindP:
			dec := ct.Decimals
			if t.Kind == KindN {
				dec = 0
			}
			r, err := convert8(t, v, TypeP(16, dec))
			if err != nil {
				return decimal{}, conversionError(err, strings.TrimRight(s, " "))
			}
			return r.(Packed).decimal(dec), nil
		case KindDecfloat34:
			r, err := convert8(t, v, TypeDecfloat34)
			if err != nil {
				return decimal{}, conversionError(err, strings.TrimRight(s, " "))
			}
			return r.(Decfloat).decimal(), nil
		}
	case KindX, KindXString:
		target := TypeI
		if ct.Kind == KindInt8 {
			target = TypeInt8
		}
		r, err := convert8(t, v, target)
		if err != nil {
			return decimal{}, err
		}
		return numericDecimalMust(target, r), nil
	case KindD:
		return decimalFromInt64(int64(dDayNumber(v.(string)))), nil
	case KindT:
		return decimalFromInt64(int64(tSeconds(v.(string)))), nil
	}
	panic(fmt.Sprintf("abap: %v in comparison type %v", t, ct))
}

func numericDecimalMust(t Type, v any) decimal {
	d, ok := numericDecimal(t, v)
	if !ok {
		panic(fmt.Sprintf("abap: %v is not numeric", t))
	}
	return d
}

// comparisonFloat is the value of an operand in the comparison type f.
func comparisonFloat(t Type, v any) (float64, error) {
	r, err := convert8(t, v, TypeF)
	if err != nil {
		s, _ := v.(string)
		return 0, conversionError(err, strings.TrimRight(s, " "))
	}
	return r.(float64), nil
}

// comparisonText is an operand as text of the comparison type c, string, n, d or t.
func comparisonText(t Type, v any, ct Type) string {
	switch t.Kind {
	case KindC, KindN, KindD, KindT:
		s := v.(string)
		if ct.Kind == KindString && t.Kind == KindC {
			return textTrimRight(s, " ")
		}
		return s
	case KindString:
		return v.(string)
	case KindX, KindXString:
		return FromUTF8(strings.ToUpper(fmt.Sprintf("%x", v.(string))))
	}
	panic(fmt.Sprintf("abap: %v in comparison type %v", t, ct))
}

// compareText compares two texts of the comparison type k: c pads the shorter with blanks on the right, n with
// zeros on the left; string, d and t compare as they are, a prefix being smaller.
func compareText(x, y string, k Kind) int {
	switch k {
	case KindC:
		n := max(textLen(x), textLen(y))
		x, y = textLeft(x, n, ' '), textLeft(y, n, ' ')
	case KindN:
		n := max(textLen(x), textLen(y))
		x, y = textRight(x, n, '0'), textRight(y, n, '0')
	}
	return strings.Compare(x, y)
}

// compareDateTimeText compares a d or t value with a c, n or string operand (comparison type c, n or string).
// A string compared with a t is padded with zeros to the six characters of t if it is shorter, then the strings
// are compared (a longer string is not cut); with a d the strings are compared as they are. Otherwise, if the lengths
// differ, the longer operand is cut to the length of the shorter one when only blanks (for t also zeros) are cut,
// else the shorter one is padded with blanks; then the characters are compared.
func compareDateTimeText(k Kind, dt string, other Type, s string) int {
	if other.Kind == KindString {
		if k == KindT && textLen(s) < 6 {
			s = textLeft(s, 6, '0')
		}
		return strings.Compare(dt, s)
	}
	cuttable := func(rest string) bool {
		if k == KindT {
			return textTrimRight(rest, " 0") == ""
		}
		return textTrimRight(rest, " ") == ""
	}
	x, y := dt, s
	switch {
	case len(x) > len(y) && cuttable(x[len(y):]):
		x = x[:len(y)]
	case len(y) > len(x) && cuttable(y[len(x):]):
		y = y[:len(x)]
	}
	n := max(textLen(x), textLen(y))
	return strings.Compare(textLeft(x, n, ' '), textLeft(y, n, ' '))
}

func comparisonUtclong(t Type, v any) (Utclong, error) {
	if t.Kind == KindUtclong {
		return v.(Utclong), nil
	}
	r, err := convert8(t, v, TypeUtclong)
	if err != nil {
		if e, ok := err.(*Exception); ok && e.Class == CxConversionNoDateTime {
			return 0, &RuntimeError{Name: "CONVT_NO_DATETIME", Text: "Incorrect format or invalid value for a date with time."}
		}
		return 0, err
	}
	return r.(Utclong), nil
}

func cmpFloat(x, y float64) int {
	switch {
	case x < y:
		return -1
	case x > y:
		return 1
	}
	return 0
}

func cmpInt(x, y int64) int {
	switch {
	case x < y:
		return -1
	case x > y:
		return 1
	}
	return 0
}
