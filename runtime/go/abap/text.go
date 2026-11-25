package abap

// Text as ABAP holds it: c, n, d, t and string values are UTF-16 code units, big-endian, in a Go string (decision
// "Storage" in docs/aot_for_abap.md). Lengths, offsets, truncation and ordering then follow ABAP's code units, also
// for characters outside the Basic Multilingual Plane, and byte order is ABAP's order of text.
//
// The exported entry points (Convert, Compare, Operand, Calculate, Format, Initial, the console) take and give text
// in this form. The rules that read or write numbers, dates and times work on ASCII and get text converted to and
// from UTF-8 at those entry points; text to text moves and text comparisons work on the code units directly. UTF-8
// is used only where text leaves the program (console, list).

import (
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// FromUTF8 is s as ABAP text (UTF-16 code units, big-endian).
func FromUTF8(s string) string {
	ascii := true
	for i := 0; i < len(s); i++ {
		if s[i] >= utf8.RuneSelf {
			ascii = false
			break
		}
	}
	if ascii {
		b := make([]byte, 2*len(s))
		for i := 0; i < len(s); i++ {
			b[2*i+1] = s[i]
		}
		return string(b)
	}
	b := make([]byte, 0, 2*len(s))
	for _, r := range s {
		for _, u := range utf16.AppendRune(nil, r) {
			b = append(b, byte(u>>8), byte(u))
		}
	}
	return string(b)
}

// ToUTF8 is the ABAP text t as UTF-8. A surrogate without its partner (a text cut between the two code units of a
// character) becomes U+FFFD.
func ToUTF8(t string) string {
	ascii := true
	for i := 0; i+1 < len(t); i += 2 {
		if t[i] != 0 || t[i+1] >= utf8.RuneSelf {
			ascii = false
			break
		}
	}
	if ascii {
		b := make([]byte, len(t)/2)
		for i := range b {
			b[i] = t[2*i+1]
		}
		return string(b)
	}
	units := make([]uint16, len(t)/2)
	for i := range units {
		units[i] = uint16(t[2*i])<<8 | uint16(t[2*i+1])
	}
	return string(utf16.Decode(units))
}

// isText is true for the kinds whose values are ABAP text.
func isText(k Kind) bool {
	switch k {
	case KindC, KindN, KindD, KindT, KindString:
		return true
	}
	return false
}

// unit is the code unit of an ASCII character.
func unit(c byte) string { return string([]byte{0, c}) }

// textLen is the number of code units of t.
func textLen(t string) int { return len(t) / 2 }

// repeatText is n times the ASCII character c.
func repeatText(c byte, n int) string { return strings.Repeat(unit(c), n) }

// textLeft places t left-aligned in n code units: cut on the right, or padded with pad.
func textLeft(t string, n int, pad byte) string {
	if len(t) >= 2*n {
		return t[:2*n]
	}
	return t + repeatText(pad, n-textLen(t))
}

// textRight places t right-aligned in n code units: cut on the left, or padded with pad.
func textRight(t string, n int, pad byte) string {
	if len(t) >= 2*n {
		return t[len(t)-2*n:]
	}
	return repeatText(pad, n-textLen(t)) + t
}

// textTrimRight removes the trailing code units that are one of the ASCII characters in set.
func textTrimRight(t string, set string) string {
	for len(t) >= 2 && t[len(t)-2] == 0 && strings.IndexByte(set, t[len(t)-1]) >= 0 {
		t = t[:len(t)-2]
	}
	return t
}

// textDigits keeps the digits 0-9 of t.
func textDigits(t string) string {
	var b strings.Builder
	for i := 0; i+1 < len(t); i += 2 {
		if t[i] == 0 && t[i+1] >= '0' && t[i+1] <= '9' {
			b.WriteString(t[i : i+2])
		}
	}
	return b.String()
}

// Convert converts v of type src into type dst. The error is an *Exception (catchable) or a *RuntimeError.
func Convert(src Type, v any, dst Type) (any, error) {
	if isText(src.Kind) {
		s := v.(string)
		if isText(dst.Kind) {
			return convertText(src, s, dst)
		}
		v = ToUTF8(s)
	}
	r, err := convert8(src, v, dst)
	if err == nil && isText(dst.Kind) {
		r = FromUTF8(r.(string))
	}
	return r, err
}

// convertText is the cells between the text kinds c, string, n, d and t, on code units (see fromText, fromN and
// fromDateTime for the same cells on UTF-8).
func convertText(src Type, s string, dst Type) (any, error) {
	switch src.Kind {
	case KindC, KindString:
		switch dst.Kind {
		case KindC:
			return textLeft(s, dst.Length, ' '), nil
		case KindString:
			if src.Kind == KindC {
				return textTrimRight(s, " "), nil
			}
			return s, nil
		case KindN:
			return textRight(textDigits(s), dst.Length, '0'), nil
		case KindD:
			if src.Kind == KindString && s == "" {
				return repeatText('0', 8), nil
			}
			return textLeft(s, 8, ' '), nil
		case KindT:
			return textLeft(s, 6, '0'), nil
		}
	case KindN:
		switch dst.Kind {
		case KindC:
			return textLeft(s, dst.Length, ' '), nil
		case KindString:
			return textTrimRight(s, " "), nil
		case KindN:
			return textRight(s, dst.Length, '0'), nil
		case KindD:
			return textLeft(s, 8, ' '), nil
		case KindT:
			return textLeft(s, 6, '0'), nil
		}
	case KindD, KindT:
		switch {
		case src.Kind == KindD && dst.Kind == KindT:
			return nil, &RuntimeError{Name: "MOVE_NOT_SUPPORTED", Text: `Assigning type "D" to type "T" is not supported.`}
		case src.Kind == KindT && dst.Kind == KindD:
			return nil, &RuntimeError{Name: "MOVE_NOT_SUPPORTED", Text: `Assigning type "T" to type "D" is not supported.`}
		}
		switch dst.Kind {
		case KindC:
			return textLeft(s, dst.Length, ' '), nil
		case KindString:
			return textTrimRight(s, " "), nil
		case KindN:
			return textLeft(s, dst.Length, '0'), nil
		case KindD, KindT:
			return s, nil
		}
	}
	panic("abap: no text conversion from " + src.String() + " to " + dst.String())
}
