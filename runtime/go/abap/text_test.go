package abap

import (
	"strings"
	"testing"
)

// Text outside the Basic Multilingual Plane: lengths, cuts and order count UTF-16 code units, as in ABAP.

const grin = "\U0001F600" // two code units, D83D DE00

func TestTextRoundTrip(t *testing.T) {
	for _, s := range []string{"", "abc", "Grüße", grin + "x", "�"} {
		if got := ToUTF8(FromUTF8(s)); got != s {
			t.Errorf("%q: got %q back", s, got)
		}
	}
	if got, want := FromUTF8(grin), "\xD8\x3D\xDE\x00"; got != want {
		t.Errorf("code units of %q: got % X, want % X", grin, got, want)
	}
}

func TestTextLengthsCountCodeUnits(t *testing.T) {
	s := FromUTF8(grin)
	c1 := MustConvert[string](TypeString, s, TypeC(1))
	if got, want := c1, "\xD8\x3D"; got != want {
		t.Errorf("c LENGTH 1: got % X, want the high surrogate % X", got, want)
	}
	if got := ToUTF8(c1); got != "�" {
		t.Errorf("a lone surrogate leaves the program as %q, want U+FFFD", got)
	}
	c4 := MustConvert[string](TypeString, FromUTF8(grin+"a"), TypeC(4))
	if got, want := ToUTF8(c4), grin+"a "; got != want {
		t.Errorf("c LENGTH 4: got %q, want %q", got, want)
	}
	if got := ToUTF8(MustConvert[string](TypeC(4), c4, TypeString)); got != grin+"a" {
		t.Errorf("back to string: got %q", got)
	}
}

func TestTextOrderIsCodeUnitOrder(t *testing.T) {
	s := FromUTF8(grin)
	for _, other := range []string{"", "�"} {
		if r, err := Compare(TypeString, s, TypeString, FromUTF8(other)); err != nil || r != -1 {
			t.Errorf("%q against %q: got %d %v, want -1", grin, other, r, err)
		}
	}
	c2 := MustConvert[string](TypeString, s, TypeC(2))
	if r, err := Compare(TypeC(2), c2, TypeString, s); err != nil || r != 0 {
		t.Errorf("c LENGTH 2 against the string: got %d %v, want 0", r, err)
	}
}

// List columns count code units: a character outside the Basic Multilingual Plane takes two.
func TestListColumnsCountCodeUnits(t *testing.T) {
	var b strings.Builder
	l := newList(&b, 0)
	l.Write(MustConvert[string](TypeString, FromUTF8(grin+"a"), TypeC(4)), false)
	l.Write(FromUTF8("x"), false)
	l.Write(MustConvert[string](TypeString, FromUTF8(grin), TypeC(1)), true)
	l.Write(FromUTF8("z"), false)
	l.End()
	if got, want := b.String(), grin+"a  x\n� z\n"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
