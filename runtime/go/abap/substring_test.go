package abap

import (
	"errors"
	"testing"
)

// substring runs Substring and gives the exception class instead of panicking.
func substring(t Type, v string, off, length int32, hasLength bool) (st Type, sv string, exc string) {
	defer func() {
		if r := recover(); r != nil {
			var e *Exception
			if err, ok := r.(error); ok && errors.As(err, &e) {
				exc = e.Class
				return
			}
			panic(r)
		}
	}()
	st, sv = Substring(t, v, off, length, hasLength)
	return
}

func TestSubstring(t *testing.T) {
	const rest = -99 // no length given
	c5, s := FromUTF8("abcde"), FromUTF8("abcdef")
	cases := []struct {
		t        Type
		v        string
		off, len int32
		want     string // UTF-8, or the exception class
		wantType Type
	}{
		// a flat field: within it and at least one character
		{TypeC(5), c5, 1, 3, "bcd", TypeC(3)},
		{TypeC(5), c5, 4, rest, "e", TypeC(1)},
		{TypeC(5), c5, 0, 5, "abcde", TypeC(5)},
		{TypeC(5), c5, 4, 0, CxRangeOutOfBounds, Type{}},
		{TypeC(5), c5, 0, 0, CxRangeOutOfBounds, Type{}},
		{TypeC(5), c5, 5, rest, CxRangeOutOfBounds, Type{}},
		{TypeC(5), c5, 2, 4, CxRangeOutOfBounds, Type{}},
		{TypeC(5), c5, -1, 1, CxRangeOutOfBounds, Type{}},
		{TypeC(5), c5, 0, -1, CxRangeOutOfBounds, Type{}},
		{TypeC(5), c5, 0, 6, CxRangeOutOfBounds, Type{}},
		// a string: within its length, possibly empty
		{TypeString, s, 2, 3, "cde", TypeString},
		{TypeString, s, 6, 0, "", TypeString},
		{TypeString, s, 6, rest, "", TypeString},
		{TypeString, s, 7, 0, CxRangeOutOfBounds, Type{}},
		{TypeString, s, 7, rest, CxRangeOutOfBounds, Type{}},
		{TypeString, s, 2, 5, CxRangeOutOfBounds, Type{}},
		{TypeString, s, -1, 1, CxRangeOutOfBounds, Type{}},
		{TypeString, s, 0, -1, CxRangeOutOfBounds, Type{}},
		// d, t and n give n
		{TypeD, FromUTF8("20240229"), 4, 2, "02", TypeN(2)},
		{TypeT, FromUTF8("123456"), 2, rest, "3456", TypeN(4)},
		{TypeN(4), FromUTF8("0012"), 2, 2, "12", TypeN(2)},
		// a character outside the Basic Multilingual Plane is two code units
		{TypeString, FromUTF8("\U0001F600a"), 2, 1, "a", TypeString},
	}
	for _, c := range cases {
		hasLength := c.len != rest
		st, sv, exc := substring(c.t, c.v, c.off, c.len, hasLength)
		got := exc
		if exc == "" {
			got = ToUTF8(sv)
		}
		if got != c.want || (exc == "" && st != c.wantType) {
			t.Errorf("%v %q +%d(%d): got %q %v, want %q %v", c.t, ToUTF8(c.v), c.off, c.len, got, st, c.want, c.wantType)
		}
	}

	// x and xstring count bytes
	if st, sv, _ := substring(TypeX(4), "\x01\x02\x03\x04", 1, 2, true); st != TypeX(2) || sv != "\x02\x03" {
		t.Errorf("x: got %v %x", st, sv)
	}
	if st, sv, _ := substring(TypeXString, "\x0a\x0b\x0c", 1, 1, true); st != TypeXString || sv != "\x0b" {
		t.Errorf("xstring: got %v %x", st, sv)
	}
	if _, _, exc := substring(TypeX(2), "\x01\x02", 2, 0, false); exc != CxRangeOutOfBounds {
		t.Errorf("x beyond its length: got %q", exc)
	}
}

func TestOverwrite(t *testing.T) {
	v := FromUTF8("abcdefghij")
	st, _ := Substring(TypeC(10), v, 2, 3, true)
	sub := MustConvert[string](TypeString, FromUTF8("XYZW"), st)
	if got := ToUTF8(Overwrite(TypeC(10), v, 2, sub)); got != "abXYZfghij" {
		t.Errorf("c: got %q", got)
	}
	if got := Overwrite(TypeX(4), "\x01\x02\x03\x04", 1, "\xff\xee"); got != "\x01\xff\xee\x04" {
		t.Errorf("x: got %x", got)
	}
}

func TestStrlen(t *testing.T) {
	cases := []struct {
		t    Type
		v    string
		want int32
	}{
		{TypeC(5), "ab", 2},
		{TypeC(5), " a", 2},
		{TypeC(5), "", 0},
		{TypeString, "ab  ", 4},
		{TypeString, "", 0},
		{TypeN(4), "0012", 4},
		{TypeD, "00000000", 8},
		{TypeT, "123456", 6},
		{TypeString, "\U0001F600a", 3},
	}
	for _, c := range cases {
		v := FromUTF8(c.v)
		if c.t.Kind == KindC {
			v = textLeft(v, c.t.Length, ' ')
		}
		got := MustCalculate[int32](Strlen(c.t, v), TypeI)
		if got != c.want {
			t.Errorf("strlen( %v %q ): got %d, want %d", c.t, c.v, got, c.want)
		}
	}
}
