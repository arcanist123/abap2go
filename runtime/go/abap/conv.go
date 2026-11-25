package abap

// The conversion rules for elementary data objects: the cells of the conversion table in
// docs/spec/conversion.md, one implementation per cell. Static operands and generic operands call the same Convert,
// so the two paths cannot drift.
//
// Families, by source kind:
//   - text (c, string): copied or read as a number, hex digits or a time stamp, depending on the target;
//   - n: copied to text targets, read as a number (c's rules) for the others;
//   - d, t: copied to text targets, their day or second count for numeric targets;
//   - x, xstring: hex digits for text targets, an integer (the last 4 bytes, 8 for int8) for numeric targets;
//   - i, int8, b, s: an exact integer;
//   - p: an exact decimal; f: its 17-digit decimal form; decfloat: an exact decimal;
//   - utclong: only text and utclong.
//
// d, t, x and xstring targets take an integer: a decimal source is rounded into the range of i first, so a
// number beyond it is an overflow there even where int8 would hold it.

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// convert8 is Convert with text as UTF-8 (see text.go): the rules that read and write numbers, dates and times.
func convert8(src Type, v any, dst Type) (any, error) {
	switch src.Kind {
	case KindC, KindString:
		return fromText(src, v.(string), dst)
	case KindN:
		return fromN(v.(string), dst)
	case KindD:
		if dst.Kind == KindT {
			return nil, &RuntimeError{Name: "MOVE_NOT_SUPPORTED", Text: `Assigning type "D" to type "T" is not supported.`}
		}
		return fromDateTime(v.(string), int64(dDayNumber(v.(string))), dst)
	case KindT:
		if dst.Kind == KindD {
			return nil, &RuntimeError{Name: "MOVE_NOT_SUPPORTED", Text: `Assigning type "T" to type "D" is not supported.`}
		}
		return fromDateTime(v.(string), int64(tSeconds(v.(string))), dst)
	case KindX, KindXString:
		return fromBytes(v.(string), dst)
	case KindI:
		return fromInteger(int64(v.(int32)), false, dst)
	case KindB:
		return fromInteger(int64(v.(uint8)), false, dst)
	case KindS:
		return fromInteger(int64(v.(int16)), false, dst)
	case KindInt8:
		return fromInteger(v.(int64), true, dst)
	case KindP:
		return fromPacked(v.(Packed).decimal(src.Decimals), dst)
	case KindF:
		return fromFloat(v.(float64), dst)
	case KindDecfloat16, KindDecfloat34:
		return fromDecfloat(v.(Decfloat).decimal(), dst)
	case KindUtclong:
		return fromUtclong(v.(Utclong), dst)
	}
	panic(fmt.Sprintf("abap: no conversion from %v", src))
}

// MustConvert is Convert for generated code: an error panics, to be caught by a TRY or end the program.
func MustConvert[T any](src Type, v any, dst Type) T {
	r, err := Convert(src, v, dst)
	if err != nil {
		panic(err)
	}
	return r.(T)
}

// fromText: c (with its trailing blanks) and string.
func fromText(src Type, s string, dst Type) (any, error) {
	switch dst.Kind {
	case KindC:
		return fitLeft(s, dst.Length, " "), nil
	case KindString:
		if src.Kind == KindC {
			return trimBlanksRight(s), nil
		}
		return s, nil
	case KindN:
		return digitsToN(s, dst.Length), nil
	case KindD:
		if src.Kind == KindString && s == "" {
			return "00000000", nil
		}
		return fitLeft(s, 8, " "), nil
	case KindT:
		return fitLeft(s, 6, "0"), nil
	case KindX:
		return fitBytesLeft(hexPrefix(s), dst.Length), nil
	case KindXString:
		return hexPrefix(s), nil
	case KindF:
		return parseFloat(s)
	case KindUtclong:
		return parseUtclong(s)
	case KindDecfloat16, KindDecfloat34:
		d, ok := parseNumber(s, true)
		if !ok {
			return nil, errNoNumber
		}
		return toNumeric(d, dst, false)
	}
	d, ok := parseNumber(s, false)
	if !ok {
		return nil, errNoNumber
	}
	return toNumeric(d, dst, false)
}

// digitsToN keeps the digits of s, right-aligned in n LENGTH n: zeros in front, cut on the left.
func digitsToN(s string, n int) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			b.WriteByte(s[i])
		}
	}
	return fitRight(b.String(), n, "0")
}

// fromN: copied to text targets (zeros in front for n, zeros behind for t), read as a number otherwise.
func fromN(s string, dst Type) (any, error) {
	switch dst.Kind {
	case KindC:
		return fitLeft(s, dst.Length, " "), nil
	case KindString:
		return trimBlanksRight(s), nil
	case KindN:
		return fitRight(s, dst.Length, "0"), nil
	case KindD:
		return fitLeft(s, 8, " "), nil
	case KindT:
		return fitLeft(s, 6, "0"), nil
	case KindX, KindXString:
		d, ok := parseNumber(s, false)
		if !ok {
			return nil, errNoNumber
		}
		i, ok := d.int32()
		if !ok {
			return nil, errOverflow
		}
		return fromInteger(int64(i), false, dst)
	case KindUtclong:
		return nil, errNotSupported
	}
	return fromText(TypeString, s, dst)
}

// fromDateTime: d and t are copied to text targets (n gets zeros behind); numeric targets take the day number or
// the number of seconds (0 for an invalid date or time).
func fromDateTime(s string, count int64, dst Type) (any, error) {
	switch dst.Kind {
	case KindC:
		return fitLeft(s, dst.Length, " "), nil
	case KindString:
		return trimBlanksRight(s), nil
	case KindN:
		return fitLeft(s, dst.Length, "0"), nil
	case KindD, KindT:
		return s, nil
	case KindUtclong:
		return nil, errNotSupported
	}
	return fromInteger(count, false, dst)
}

// fromBytes: x and xstring. Text targets get the hex digits; int8 takes the last 8 bytes, other numeric targets
// the last 4 bytes as a signed i (shorter values are filled with zero bytes in front).
func fromBytes(b string, dst Type) (any, error) {
	switch dst.Kind {
	case KindC:
		return fitLeft(strings.ToUpper(fmt.Sprintf("%x", b)), dst.Length, " "), nil
	case KindString:
		return strings.ToUpper(fmt.Sprintf("%x", b)), nil
	case KindX:
		return fitBytesLeft(b, dst.Length), nil
	case KindXString:
		return b, nil
	case KindUtclong:
		return nil, errNotSupported
	case KindInt8:
		var u uint64
		for _, c := range []byte(fitBytesRight(b, 8)) {
			u = u<<8 | uint64(c)
		}
		return int64(u), nil
	}
	var u uint32
	for _, c := range []byte(fitBytesRight(b, 4)) {
		u = u<<8 | uint32(c)
	}
	return fromInteger(int64(int32(u)), false, dst)
}

// fromInteger: i, b, s (wide false) and int8 (wide true); also the integer that d, t, x and decimal sources pass
// to the targets d, t, x and xstring.
func fromInteger(v int64, wide bool, dst Type) (any, error) {
	d := decimalFromInt64(v)
	switch dst.Kind {
	case KindC:
		return numberToC(d, dst.Length), nil
	case KindString:
		return numberToString(d), nil
	case KindN:
		return fitRight(d.digits(), dst.Length, "0"), nil
	case KindD:
		// an int8 counts with its lower four bytes as an i; t takes the whole value
		return dFromDayNumber(int64(int32(v))), nil
	case KindT:
		return tFromSeconds(v), nil
	case KindX:
		return fitBytesRight(integerBytes(v, wide), dst.Length), nil
	case KindXString:
		b := strings.TrimLeft(integerBytes(v, wide), "\x00")
		if b == "" {
			b = "\x00"
		}
		return b, nil
	case KindF:
		return float64(v), nil
	case KindDecfloat16, KindDecfloat34:
		return toNumeric(d, dst, false)
	case KindUtclong:
		return nil, errNotSupported
	}
	return toNumeric(d, dst, false)
}

// integerBytes is the two's complement of v, big-endian, in 4 bytes (8 if wide).
func integerBytes(v int64, wide bool) string {
	if !wide {
		u := uint32(int32(v))
		return string([]byte{byte(u >> 24), byte(u >> 16), byte(u >> 8), byte(u)})
	}
	u := uint64(v)
	b := make([]byte, 8)
	for i := 7; i >= 0; i-- {
		b[i] = byte(u)
		u >>= 8
	}
	return string(b)
}

// toNumeric converts an exact decimal into the numeric targets i, int8, b, s, p, f, decfloat16/34 and n, rounding
// half away from zero. n gets the absolute value; nOverflow decides whether too many digits for n are an
// overflow (decfloat sources) or cut on the left (all others).
func toNumeric(d decimal, dst Type, nOverflow bool) (any, error) {
	switch dst.Kind {
	case KindI:
		if v, ok := d.int32(); ok {
			return v, nil
		}
	case KindInt8:
		if v, ok := d.int64(); ok {
			return v, nil
		}
	case KindB:
		if v := d.integer(); v.Sign() >= 0 && v.Cmp(bigOf(255)) <= 0 {
			return uint8(v.Int64()), nil
		}
	case KindS:
		if v := d.integer(); v.Cmp(bigOf(-32768)) >= 0 && v.Cmp(bigOf(32767)) <= 0 {
			return int16(v.Int64()), nil
		}
	case KindP:
		r := d.roundAway(-dst.Decimals)
		if len(r.digits()) <= dst.pDigits() || r.isZero() {
			return packedFromBig(r.signed()), nil
		}
	case KindF:
		f, err := strconv.ParseFloat(d.plainOrScientific(), 64)
		if math.IsInf(f, 0) || err != nil && !strings.Contains(err.Error(), "range") {
			return nil, errOverflow
		}
		return f, nil
	case KindDecfloat16:
		if v, ok := decfloat16Format.toDecfloat(d); ok {
			return v, nil
		}
	case KindDecfloat34:
		if v, ok := decfloat34Format.toDecfloat(d); ok {
			return v, nil
		}
	case KindN:
		digits := d.roundAway(0).digits()
		if nOverflow && len(digits) > dst.Length {
			return nil, errOverflow
		}
		return fitRight(digits, dst.Length, "0"), nil
	case KindD, KindT, KindX, KindXString:
		v, ok := d.int32()
		if !ok {
			return nil, errOverflow
		}
		return fromInteger(int64(v), false, dst)
	case KindUtclong:
		return nil, errNotSupported
	default:
		panic(fmt.Sprintf("abap: %v is not a numeric target", dst))
	}
	return nil, errOverflow
}

// fromPacked: p. Text targets get the digits with the point and the sign character.
func fromPacked(d decimal, dst Type) (any, error) {
	switch dst.Kind {
	case KindC:
		return numberToC(d, dst.Length), nil
	case KindString:
		return numberToString(d), nil
	}
	return toNumeric(d, dst, false)
}

// fromFloat: f. Text targets get scientific notation; decfloat targets the 17 (decfloat16: 16) digit decimal
// form without trailing zeros; other numeric targets round the 17-digit form.
func fromFloat(v float64, dst Type) (any, error) {
	switch dst.Kind {
	case KindC:
		return floatToC(v, dst.Length), nil
	case KindString:
		return floatToString(v), nil
	case KindF:
		return v, nil
	case KindDecfloat16, KindDecfloat34:
		sig := 17
		if dst.Kind == KindDecfloat16 {
			sig = 16
		}
		d := floatDecimal(v, sig)
		for d.coef.Sign() != 0 && d.digits()[len(d.digits())-1] == '0' {
			d.coef.Quo(d.coef, bigTen)
			d.exp++
		}
		if d.coef.Sign() == 0 {
			d = decimal{coef: d.coef}
		}
		return toNumeric(d, dst, false)
	}
	if dst.Kind == KindInt8 {
		// the range is checked on the value itself: 2^63 is an overflow although its 17-digit form fits
		if _, ok := exactFloat(v).int64(); !ok {
			return nil, errOverflow
		}
	}
	return toNumeric(floatDecimal(v, 17), dst, false)
}

// fromDecfloat: decfloat16 and decfloat34. Text targets get the IEEE string form (c: fitted, see decfloatToC); n
// raises an overflow when the digits do not fit; f keeps a negative zero.
func fromDecfloat(d decimal, dst Type) (any, error) {
	switch dst.Kind {
	case KindC:
		return decfloatToC(d, dst.Length)
	case KindString:
		return decfloatString(d), nil
	case KindF:
		if d.isZero() {
			if d.neg {
				return math.Copysign(0, -1), nil
			}
			return float64(0), nil
		}
	}
	return toNumeric(d, dst, true)
}

// fromUtclong: utclong converts only to c, string and utclong.
func fromUtclong(u Utclong, dst Type) (any, error) {
	switch dst.Kind {
	case KindC:
		return fitLeft(formatUtclong(u), dst.Length, " "), nil
	case KindString:
		return formatUtclong(u), nil
	case KindUtclong:
		return u, nil
	}
	return nil, errNotSupported
}
