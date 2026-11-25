package abap

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

// The cells of the WRITE formatting table, from testdata/write.tsv (its header explains the format).
func TestWriteTable(t *testing.T) {
	f, err := os.Open("testdata/write.tsv")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	line, failed, cells := 0, 0, 0
	for scanner.Scan() {
		line++
		text := strings.TrimSuffix(scanner.Text(), "\r")
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		cols := strings.Split(text, "\t")
		if len(cols) != 4 {
			t.Fatalf("line %d: %d columns", line, len(cols))
		}
		cells++
		got := "[" + formatCell(t, settingsOf(t, cols[0]), cols[1], unbracket(cols[2])) + "]"
		if got != cols[3] {
			failed++
			if failed <= 60 {
				t.Errorf("line %d: %s %s %s: got %s, want %s", line, cols[0], cols[1], cols[2], got, cols[3])
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

// settingsOf reads the settings column: the decimal notation (_ for blank) and the date format.
func settingsOf(t *testing.T, code string) Settings {
	if len(code) != 2 {
		t.Fatalf("settings %q", code)
	}
	s := DefaultSettings
	s.DecimalNotation = strings.ReplaceAll(code[:1], "_", " ")[0]
	s.DateFormat = code[1]
	return s
}

func formatCell(t *testing.T, settings Settings, typeName, value string) string {
	typ := parseTypeName(t, typeName)
	var v any
	switch typ.Kind {
	case KindC, KindN, KindD, KindT:
		v = textLeft(FromUTF8(value), typ.textLength(), ' ')
	default:
		var err error
		if v, err = Convert(TypeString, FromUTF8(value), typ); err != nil {
			t.Fatalf("%s %q: %v", typeName, value, err)
		}
	}
	s := Format(settings, typ, v)
	if n := OutputLength(typ); n > 0 && textLen(s) != n {
		t.Errorf("%s %q: %q is not %d code units", typeName, value, ToUTF8(s), n)
	}
	return ToUTF8(s)
}

// Settings the table cannot show (decimal notation Y, date formats 3 and 6), from the format descriptions of the
// user master record.
func TestWriteOtherSettings(t *testing.T) {
	y := DefaultSettings
	y.DecimalNotation = 'Y'
	cases := []struct {
		settings   Settings
		typ, value string
		want       string
	}{
		{y, "i", "-1234567", " 1 234 567-"},
		{y, "p8.2", "1234567.89", "    1 234 567,89 "},
		{y, "f", "1.5", "  1,5000000000000000E+00"},
		{y, "decfloat16", "-1234.5", "                -1 234,5"},
		{y, "utclong", "2024-02-29T12:34:56.5", "29.02.2024 12:34:56,5000000   "},
		{Settings{DateFormat: '3', DecimalNotation: 'X'}, "d", "20240229", "02292024"},
		{Settings{DateFormat: '3', DecimalNotation: 'X'}, "utclong", "2024-02-29T12:34:56", "02-29-2024 12:34:56.0000000   "},
		{Settings{DateFormat: '6', DecimalNotation: 'X'}, "d", "20240229", "20240229"},
		{Settings{DateFormat: '6', DecimalNotation: 'X'}, "utclong", "2024-02-29T12:34:56", "2024-02-29 12:34:56.0000000   "},
	}
	for _, c := range cases {
		if got := formatCell(t, c.settings, c.typ, c.value); got != c.want {
			t.Errorf("%c%c %s %s: got [%s], want [%s]", c.settings.DecimalNotation, c.settings.DateFormat, c.typ, c.value, got, c.want)
		}
	}
}
