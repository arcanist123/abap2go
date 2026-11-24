package abap

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

// The cells of the comparison table, from testdata/comparison.tsv (its header explains the format), and the random
// cells of comparison_random.tsv, held out while the rules were worked out.
func TestComparisonTable(t *testing.T) { runComparisonFile(t, "testdata/comparison.tsv") }

func TestComparisonRandom(t *testing.T) { runComparisonFile(t, "testdata/comparison_random.tsv") }

func runComparisonFile(t *testing.T, file string) {
	f, err := os.Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	line, cells, failed := 0, 0, 0
	for scanner.Scan() {
		line++
		text := strings.TrimSuffix(scanner.Text(), "\r")
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		cols := strings.Split(text, "\t")
		if len(cols) != 5 {
			t.Fatalf("line %d: %d columns", line, len(cols))
		}
		cells++
		ta, tb := parseTypeName(t, cols[0]), parseTypeName(t, cols[2])
		a, b := comparisonCellValue(t, ta, cols[1]), comparisonCellValue(t, tb, cols[3])
		got := comparisonOutcome(Compare(ta, a, tb, b))
		if got != cols[4] {
			failed++
			if failed <= 100 {
				t.Errorf("line %d: %s %s vs %s %s: got %s, want %s", line, cols[0], cols[1], cols[2], cols[3], got, cols[4])
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

func comparisonCellValue(t *testing.T, typ Type, col string) any {
	value := strings.TrimSuffix(strings.TrimPrefix(col, "["), "]")
	if typ.Kind == KindUtclong {
		v, err := Convert(TypeString, value, typ)
		if err != nil {
			t.Fatalf("utclong %q: %v", value, err)
		}
		return v
	}
	v, err := cellValue(typ, value)
	if err != nil {
		t.Fatalf("%v %q: %v", typ, value, err)
	}
	return v
}

func comparisonOutcome(r int, err error) string {
	if err != nil {
		switch e := err.(type) {
		case *RuntimeError:
			return "DUMP:" + e.Name
		case *Exception:
			return "EXC:" + e.Class
		}
		return err.Error()
	}
	return [...]string{"<", "=", ">"}[r+1]
}
