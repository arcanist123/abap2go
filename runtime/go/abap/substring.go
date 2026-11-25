package abap

// Offset/length access (dobj+off(len), dobj+off, dobj(len)) and strlen( ). Offsets and lengths count characters
// (UTF-16 code units, see text.go) for the text kinds and bytes for x and xstring.
//
// The subfield of c is a c, of n, d and t an n, of x an x, of string a string and of xstring an xstring. A
// subfield of a flat field must lie within it and be at least one character or byte long; a subfield of a string
// or xstring lies within its current length and may be empty. Anything else raises CX_SY_RANGE_OUT_OF_BOUNDS.

// CxRangeOutOfBounds is the exception of a subfield outside its data object.
const CxRangeOutOfBounds = "CX_SY_RANGE_OUT_OF_BOUNDS"

var errRangeOutOfBounds = &Exception{Class: CxRangeOutOfBounds}

// unitWidth is the number of bytes of one character (text) or byte (x, xstring) of a value of kind k.
func unitWidth(k Kind) int {
	if isText(k) {
		return 2
	}
	return 1
}

// Substring is the subfield v+off(length) of v of type t, or v+off (the rest) when hasLength is false: its type
// and value. It panics with CX_SY_RANGE_OUT_OF_BOUNDS when the subfield is not within v.
func Substring(t Type, v string, off, length int32, hasLength bool) (Type, string) {
	w := unitWidth(t.Kind)
	size := int32(len(v) / w)
	flat := t.Kind != KindString && t.Kind != KindXString
	if !hasLength {
		length = size - off
	}
	minLength := int32(0)
	if flat {
		minLength = 1
	}
	if off < 0 || length < minLength || off > size || length > size-off {
		panic(errRangeOutOfBounds)
	}
	sub := v[int(off)*w : int(off+length)*w]
	switch t.Kind {
	case KindC:
		return TypeC(int(length)), sub
	case KindN, KindD, KindT:
		return TypeN(int(length)), sub
	case KindX:
		return TypeX(int(length)), sub
	case KindString, KindXString:
		return t, sub
	}
	panic("abap: no subfields of " + t.String())
}

// Overwrite is v of flat type t with the subfield starting at off replaced by sub, which has the subfield's type
// (Substring gives it and checks the bounds).
func Overwrite(t Type, v string, off int32, sub string) string {
	start := int(off) * unitWidth(t.Kind)
	return v[:start] + sub + v[start+len(sub):]
}

// Strlen is strlen( v ) for v of the character-like type t, as an operand of type i: the number of characters,
// without the trailing blanks of a flat field (c, n, d, t), with those of a string.
func Strlen(t Type, v string) Expr {
	if t.Kind != KindString {
		v = textTrimRight(v, " ")
	}
	return Operand(TypeI, int32(textLen(v)))
}
