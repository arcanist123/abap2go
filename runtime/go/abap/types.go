package abap

// The elementary types and how their values are held. Values are native Go values, never byte layouts (see the
// storage decision in docs/aot_for_abap.md):
//
//	c, n, d, t   string of exactly Length characters (d: 8, t: 6)
//	string       string
//	x            string of exactly Length bytes
//	xstring      string of bytes
//	i            int32
//	int8         int64
//	b            uint8
//	s            int16
//	p            Packed (the unscaled integer; the decimals belong to the type)
//	f            float64
//	decfloat16   Decfloat
//	decfloat34   Decfloat
//	utclong      Utclong
//
// Lengths of c, n, d and t count characters (runes). ABAP counts UTF-16 code units, so a character outside the
// Basic Multilingual Plane counts once here and twice in ABAP: a known gap, listed in docs/spec/conversion.md.

import "fmt"

// Kind is an elementary ABAP type kind.
type Kind uint8

const (
	KindC Kind = iota + 1
	KindN
	KindD
	KindT
	KindString
	KindX
	KindXString
	KindI
	KindInt8
	KindB
	KindS
	KindP
	KindF
	KindDecfloat16
	KindDecfloat34
	KindUtclong
)

var kindNames = map[Kind]string{
	KindC: "c", KindN: "n", KindD: "d", KindT: "t", KindString: "string", KindX: "x", KindXString: "xstring",
	KindI: "i", KindInt8: "int8", KindB: "b", KindS: "s", KindP: "p", KindF: "f",
	KindDecfloat16: "decfloat16", KindDecfloat34: "decfloat34", KindUtclong: "utclong",
}

func (k Kind) String() string {
	if n, ok := kindNames[k]; ok {
		return n
	}
	return fmt.Sprintf("Kind(%d)", uint8(k))
}

// Type is a complete elementary type: a kind with its length (characters for c and n, bytes for x and p) and, for
// p, its decimals.
type Type struct {
	Kind     Kind
	Length   int
	Decimals int
}

func (t Type) String() string {
	switch t.Kind {
	case KindC, KindN, KindX:
		return fmt.Sprintf("%s LENGTH %d", t.Kind, t.Length)
	case KindP:
		return fmt.Sprintf("p LENGTH %d DECIMALS %d", t.Length, t.Decimals)
	}
	return t.Kind.String()
}

// The types without parameters.
var (
	TypeD          = Type{Kind: KindD, Length: 8}
	TypeT          = Type{Kind: KindT, Length: 6}
	TypeString     = Type{Kind: KindString}
	TypeXString    = Type{Kind: KindXString}
	TypeI          = Type{Kind: KindI}
	TypeInt8       = Type{Kind: KindInt8}
	TypeB          = Type{Kind: KindB}
	TypeS          = Type{Kind: KindS}
	TypeF          = Type{Kind: KindF}
	TypeDecfloat16 = Type{Kind: KindDecfloat16}
	TypeDecfloat34 = Type{Kind: KindDecfloat34}
	TypeUtclong    = Type{Kind: KindUtclong}
)

// TypeC is c LENGTH length (1 to 262143).
func TypeC(length int) Type { return Type{Kind: KindC, Length: length} }

// TypeN is n LENGTH length.
func TypeN(length int) Type { return Type{Kind: KindN, Length: length} }

// TypeX is x LENGTH length.
func TypeX(length int) Type { return Type{Kind: KindX, Length: length} }

// TypeP is p LENGTH length DECIMALS decimals: 2*length-1 digits, decimals of them after the point.
func TypeP(length, decimals int) Type { return Type{Kind: KindP, Length: length, Decimals: decimals} }

// Initial is the initial value of t, in its Go representation.
func Initial(t Type) any {
	switch t.Kind {
	case KindC, KindD:
		return blanks(t.textLength())
	case KindN, KindT:
		return zeros(t.textLength())
	case KindString:
		return ""
	case KindX:
		return string(make([]byte, t.Length))
	case KindXString:
		return ""
	case KindI:
		return int32(0)
	case KindInt8:
		return int64(0)
	case KindB:
		return uint8(0)
	case KindS:
		return int16(0)
	case KindP:
		return Packed{}
	case KindF:
		return float64(0)
	case KindDecfloat16, KindDecfloat34:
		return Decfloat{}
	case KindUtclong:
		return Utclong(0)
	}
	panic(fmt.Sprintf("abap: no initial value for %v", t))
}

// textLength is the number of characters of a flat character-like type.
func (t Type) textLength() int {
	switch t.Kind {
	case KindD:
		return 8
	case KindT:
		return 6
	}
	return t.Length
}

// pDigits is the number of digits of p LENGTH t.Length.
func (t Type) pDigits() int { return 2*t.Length - 1 }
