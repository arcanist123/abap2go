package abap

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"testing"
)

// The cells of the calculation type table, from testdata/calculation.tsv (its header explains the format). The
// cells of calculation_open.tsv, whose rule is not worked out yet, are run and their differences logged.
func TestCalculationTable(t *testing.T) {
	failed, cells := runCalculationFile(t, "testdata/calculation.tsv", t.Errorf)
	if failed > 0 {
		t.Errorf("%d of %d cells differ", failed, cells)
	}
}

func TestCalculationOpen(t *testing.T) {
	failed, cells := runCalculationFile(t, "testdata/calculation_open.tsv", t.Logf)
	t.Logf("open cells: %d of %d differ", failed, cells)
}

func runCalculationFile(t *testing.T, file string, report func(string, ...any)) (failed, cells int) {
	f, err := os.Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	line := 0
	for scanner.Scan() {
		line++
		text := strings.TrimSuffix(scanner.Text(), "\r")
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		cols := strings.Split(text, "\t")
		if len(cols) != 6 {
			t.Fatalf("line %d: %d columns", line, len(cols))
		}
		cells++
		got := calculationCell(t, cols)
		if got != cols[5] {
			failed++
			if failed <= 80 {
				report("line %d: %s = %s with %s %s %s: got %s, want %s", line, cols[0], cols[1], cols[2], cols[3],
					cols[4], got, cols[5])
			}
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return failed, cells
}

// calcCellOperand is an operand column: type[value], <a>=type[value] or -.
type calcCellOperand struct {
	t       Type
	v       any
	generic bool
	set     error
}

func parseCellOperand(t *testing.T, col string) *calcCellOperand {
	if col == "-" {
		return nil
	}
	o := &calcCellOperand{}
	if rest, ok := strings.CutPrefix(col, "<a>="); ok {
		o.generic = true
		col = rest
	}
	name, value, _ := strings.Cut(col, "[")
	value = strings.TrimSuffix(value, "]")
	o.t = parseTypeName(t, name)
	o.v, o.set = cellValue(o.t, value)
	return o
}

func cellValue(typ Type, value string) (any, error) {
	switch typ.Kind {
	case KindC, KindN, KindD, KindT:
		return fitLeft(value, typ.textLength(), " "), nil
	case KindUtclong:
		return Utclong(0), nil
	}
	return Convert(TypeString, value, typ)
}

func calculationCell(t *testing.T, cols []string) string {
	ops := map[string]*calcCellOperand{}
	for i, name := range []string{"a", "b", "c"} {
		if o := parseCellOperand(t, cols[2+i]); o != nil {
			if o.t.Kind == KindUtclong {
				return "SYNTAX"
			}
			if o.set != nil {
				return "SET:" + describe(o.set)
			}
			ops[name] = o
		}
	}
	if o := ops["a"]; o != nil && o.generic {
		ops["<a>"] = o
	}
	target, expr := cols[0], cols[1]
	p := &exprParser{t: t, ops: ops}

	// assignment operators: result op= expression
	if name, start, ok := strings.Cut(target, "["); ok {
		dst := parseTypeName(t, name)
		v, err := cellValue(dst, strings.TrimSuffix(start, "]"))
		if err != nil {
			t.Fatalf("result field %s: %v", target, err)
		}
		opText, rest, _ := strings.Cut(expr, " ")
		op := map[string]Op{"+=": OpAdd, "-=": OpSubtract, "*=": OpMultiply, "/=": OpDivide}[opText]
		e := Binary(op, Operand(dst, v), p.parse(rest))
		r, err := Calculate(e, dst)
		if err != nil {
			return describe(err)
		}
		return readout(dst, r)
	}

	if target == "DATA" {
		var typ Type
		var r any
		var err error
		if inner, typeName, ok := p.conversion(expr, "CONV"); ok {
			typ = parseTypeName(t, typeName)
			r, err = Calculate(p.parse(inner), typ)
		} else {
			typ, r, err = CalculateInline(p.parse(expr))
		}
		prefix := typeNameOf(typ) + ":"
		if err != nil {
			return prefix + describe(err)
		}
		return prefix + readout(typ, r)
	}

	dst := parseTypeName(t, target)
	var r any
	var err error
	if inner, typeName, ok := p.conversion(expr, "EXACT"); ok {
		typ := dst
		switch typeName {
		case "#":
		case "f":
			return "SYNTAX"
		default:
			typ = parseTypeName(t, strings.ReplaceAll(typeName, "_", "."))
		}
		r, err = CalculateExact(p.parse(inner), typ)
		if err == nil {
			r, err = Convert(typ, r, dst)
		}
	} else {
		r, err = Calculate(p.parse(expr), dst)
	}
	if err != nil {
		return describe(err)
	}
	return readout(dst, r)
}

func typeNameOf(t Type) string {
	switch t.Kind {
	case KindC, KindN, KindX:
		return fmt.Sprintf("%s%d", t.Kind, t.Length)
	case KindP:
		return fmt.Sprintf("p%d.%d", t.Length, t.Decimals)
	}
	return t.Kind.String()
}

// exprParser reads the expressions of the test cells: operands a, b, c and <a>, number, text and string literals,
// + - * / DIV MOD ** with ABAP's priorities, parentheses, a sign, abs( ), sqrt( ) and ipow( base = exp = ).
type exprParser struct {
	t      *testing.T
	ops    map[string]*calcCellOperand
	tokens []string
	pos    int
}

// conversion splits "KEYWORD type( inner )".
func (p *exprParser) conversion(expr, keyword string) (inner, typeName string, ok bool) {
	rest, ok := strings.CutPrefix(expr, keyword+" ")
	if !ok {
		return "", "", false
	}
	typeName, inner, _ = strings.Cut(rest, "( ")
	return strings.TrimSuffix(inner, " )"), typeName, true
}

func (p *exprParser) parse(expr string) Expr {
	p.tokens, p.pos = strings.Fields(expr), 0
	e := p.sum()
	if p.pos != len(p.tokens) {
		p.t.Fatalf("expression %q: unexpected %q", expr, p.tokens[p.pos])
	}
	return e
}

func (p *exprParser) peek() string {
	if p.pos < len(p.tokens) {
		return p.tokens[p.pos]
	}
	return ""
}

func (p *exprParser) next() string {
	s := p.peek()
	p.pos++
	return s
}

func (p *exprParser) expect(s string) {
	if got := p.next(); got != s {
		p.t.Fatalf("expected %q, got %q", s, got)
	}
}

func (p *exprParser) sum() Expr {
	e := p.product()
	for {
		switch p.peek() {
		case "+":
			p.next()
			e = Binary(OpAdd, e, p.product())
		case "-":
			p.next()
			e = Binary(OpSubtract, e, p.product())
		default:
			return e
		}
	}
}

func (p *exprParser) product() Expr {
	e := p.power()
	for {
		op, ok := map[string]Op{"*": OpMultiply, "/": OpDivide, "DIV": OpDiv, "MOD": OpMod}[p.peek()]
		if !ok {
			return e
		}
		p.next()
		e = Binary(op, e, p.power())
	}
}

func (p *exprParser) power() Expr {
	e := p.primary()
	if p.peek() == "**" {
		p.next()
		return Binary(OpPower, e, p.power())
	}
	return e
}

func (p *exprParser) primary() Expr {
	tok := p.next()
	switch tok {
	case "-":
		return Negate(p.primary())
	case "(":
		e := p.sum()
		p.expect(")")
		return e
	case "abs(", "sqrt(":
		e := p.sum()
		p.expect(")")
		if tok == "abs(" {
			return Abs(e)
		}
		return Sqrt(e)
	case "ipow(":
		p.expect("base")
		p.expect("=")
		base := p.sum()
		p.expect("exp")
		p.expect("=")
		exp := p.sum()
		p.expect(")")
		return Ipow(base, exp)
	}
	if o, ok := p.ops[tok]; ok {
		if o.generic {
			return GenericOperand(o.t, o.v)
		}
		return Operand(o.t, o.v)
	}
	switch {
	case strings.HasPrefix(tok, "'"):
		s := strings.Trim(tok, "'")
		return Operand(TypeC(len(s)), s)
	case strings.HasPrefix(tok, "`"):
		return Operand(TypeString, strings.Trim(tok, "`"))
	case tok != "" && tok[0] >= '0' && tok[0] <= '9':
		v, err := Convert(TypeString, tok, TypeI)
		if err == nil {
			return Operand(TypeI, v)
		}
		pv, err := Convert(TypeString, tok, TypeP(16, 0))
		if err != nil {
			p.t.Fatalf("literal %s: %v", tok, err)
		}
		return Operand(TypeP(16, 0), pv)
	}
	p.t.Fatalf("unexpected token %q", tok)
	return nil
}
