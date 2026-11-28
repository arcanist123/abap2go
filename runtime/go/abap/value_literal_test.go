package abap

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

// The cells of testdata/value_literal.tsv: for a numeric type, d, t, x and utclong, the literal of a VALUE
// addition is a syntax error exactly when its conversion to that type raises. A c, n, string or xstring takes
// every literal, whatever the conversion does.
func TestValueLiteralTable(t *testing.T) {
	f, err := os.Open("testdata/value_literal.tsv")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	line, cells := 0, 0
	for scanner.Scan() {
		line++
		text := strings.TrimSuffix(scanner.Text(), "\r")
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		cols := strings.Split(text, "\t")
		if len(cols) != 3 {
			t.Fatalf("line %d: %d columns", line, len(cols))
		}
		dst := parseTypeName(t, cols[0])
		switch dst.Kind {
		case KindC, KindN, KindString, KindXString:
			continue
		}
		cells++
		src, v := literalValue(t, cols[1])
		_, err := Convert(src, v, dst)
		if got := map[bool]string{false: "ok", true: "error"}[err != nil]; got != cols[2] {
			t.Errorf("line %d: %s VALUE %s: conversion gives %v, the cell says %s", line, cols[0], cols[1], err, cols[2])
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if cells == 0 {
		t.Fatal("no cells")
	}
}

// literalValue is a literal as the compiler types it: '...' a c, `...` a string, a number an i, or beyond the
// range of i a p of length 8 up to 15 digits and of length 16 above.
func literalValue(t *testing.T, literal string) (Type, any) {
	switch literal[0] {
	case '\'':
		text := FromUTF8(literal[1 : len(literal)-1])
		if text == "" {
			text = FromUTF8(" ")
		}
		return TypeC(len(text) / 2), text
	case '`':
		return TypeString, FromUTF8(literal[1 : len(literal)-1])
	}
	digits := strings.TrimLeft(strings.TrimPrefix(literal, "-"), "0")
	for _, typ := range []Type{TypeI, TypeP(8, 0), TypeP(16, 0)} {
		if typ.Kind == KindP && typ.Length == 8 && len(digits) > 15 {
			continue
		}
		if v, err := Convert(TypeString, FromUTF8(literal), typ); err == nil {
			return typ, v
		}
	}
	t.Fatalf("no type for the literal %s", literal)
	return Type{}, nil
}

// An exponent far beyond a decimal floating point number, as a text can hold one, is an overflow or rounds to
// zero.
func TestDecfloatHugeExponent(t *testing.T) {
	for _, dst := range []Type{TypeDecfloat16, TypeDecfloat34} {
		for text, want := range map[string]string{
			"1E99999999999":              "EXC:CX_SY_CONVERSION_OVERFLOW",
			"1E9223372036854775807":      "EXC:CX_SY_CONVERSION_OVERFLOW",
			"1E-99999999999":             "0",
			"-12.5E-9223372036854775807": "0",
			"0E99999999999":              "0",
			"0.0E-99999999999":           "0",
		} {
			r, err := Convert(TypeString, FromUTF8(text), dst)
			got := "0"
			if err != nil {
				got = describe(err)
			} else if !r.(Decfloat).decimal().isZero() {
				got = "not zero"
			}
			if got != want {
				t.Errorf("%s into %v: got %s, want %s", text, dst, got, want)
			}
		}
	}
}
