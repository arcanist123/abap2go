package abap

import (
	"bufio"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// The cells of the conversion table, from testdata/conversion*.tsv (conversion.tsv's header explains the format).
func TestConversionTable(t *testing.T) {
	files, err := filepath.Glob("testdata/conversion*.tsv")
	if err != nil || len(files) == 0 {
		t.Fatalf("no test data: %v", err)
	}
	for _, file := range files {
		t.Run(filepath.Base(file), func(t *testing.T) { testConversionFile(t, file) })
	}
}

func testConversionFile(t *testing.T, file string) {
	f, err := os.Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	line, failed, cells := 0, 0, 0
	for scanner.Scan() {
		line++
		text := strings.TrimSuffix(scanner.Text(), "\r") // a checkout with CRLF line ends
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		cols := strings.Split(text, "\t")
		if len(cols) != 4 {
			t.Fatalf("line %d: %d columns", line, len(cols))
		}
		cells++
		got := convertCell(t, cols[0], unbracket(cols[1]), cols[2])
		if got != cols[3] {
			failed++
			if failed <= 60 {
				t.Errorf("line %d: %s %s -> %s: got %s, want %s", line, cols[0], cols[1], cols[2], got, cols[3])
			}
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if failed > 0 {
		t.Errorf("%d of %d cells differ", failed, cells)
	}
}

func unbracket(s string) string { return strings.TrimSuffix(strings.TrimPrefix(s, "["), "]") }

var typeName = regexp.MustCompile(`^(?:([cnx])(\d+)|p(\d+)\.(\d+)|(d|t|string|xstring|i|int8|b|s|f|decfloat16|decfloat34|utclong))$`)

func parseTypeName(t *testing.T, name string) Type {
	m := typeName.FindStringSubmatch(name)
	if m == nil {
		t.Fatalf("unknown type %q", name)
	}
	switch {
	case m[1] != "":
		n, _ := strconv.Atoi(m[2])
		return map[string]func(int) Type{"c": TypeC, "n": TypeN, "x": TypeX}[m[1]](n)
	case m[3] != "":
		l, _ := strconv.Atoi(m[3])
		d, _ := strconv.Atoi(m[4])
		return TypeP(l, d)
	}
	return map[string]Type{"d": TypeD, "t": TypeT, "string": TypeString, "xstring": TypeXString, "i": TypeI,
		"int8": TypeInt8, "b": TypeB, "s": TypeS, "f": TypeF, "decfloat16": TypeDecfloat16,
		"decfloat34": TypeDecfloat34, "utclong": TypeUtclong}[m[5]]
}

func convertCell(t *testing.T, srcName, value, dstName string) string {
	src, dst := parseTypeName(t, srcName), parseTypeName(t, dstName)
	var v any
	switch src.Kind {
	case KindC, KindN, KindD, KindT:
		v = fitLeft(value, src.textLength(), " ")
	default:
		var err error
		if v, err = Convert(TypeString, value, src); err != nil {
			return "SET:" + describe(err)
		}
	}
	r, err := Convert(src, v, dst)
	if err != nil {
		return describe(err)
	}
	return readout(dst, r)
}

func describe(err error) string {
	var exc *Exception
	var rte *RuntimeError
	switch {
	case errors.As(err, &exc):
		return "EXC:" + exc.Class
	case errors.As(err, &rte):
		return "DUMP:" + rte.Name
	}
	return "ERR:" + err.Error()
}

func readout(t Type, v any) string {
	switch t.Kind {
	case KindC, KindN, KindD, KindT, KindString:
		return "[" + v.(string) + "]"
	case KindX, KindXString:
		return strings.ToUpper(fmt.Sprintf("%x", v.(string)))
	case KindI:
		return strconv.Itoa(int(v.(int32)))
	case KindInt8:
		return strconv.FormatInt(v.(int64), 10)
	case KindB:
		return strconv.Itoa(int(v.(uint8)))
	case KindS:
		return strconv.Itoa(int(v.(int16)))
	case KindP:
		return v.(Packed).decimal(t.Decimals).plain()
	case KindF:
		return fmt.Sprintf("%016X", math.Float64bits(v.(float64)))
	case KindDecfloat16, KindDecfloat34:
		d := v.(Decfloat).decimal()
		c := d.digits()
		s := c[:1]
		if len(c) > 1 {
			s += "." + c[1:]
		}
		e := d.exp + len(c) - 1
		if d.isZero() {
			e = d.exp
		}
		sign := "+"
		if e < 0 {
			sign, e = "-", -e
		}
		s += fmt.Sprintf("E%s%04d", sign, e)
		if d.neg {
			s = "-" + s
		}
		return s
	case KindUtclong:
		return formatUtclong(v.(Utclong))
	}
	panic(t)
}
