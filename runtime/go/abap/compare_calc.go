package abap

// Arithmetic expressions as operands of a comparison (docs/spec/comparison.md, "Arithmetic expressions as
// operands"): the calculation type of all arithmetic expressions in one comparison comes from all operands of both
// sides (there is no result field), and it is also the comparison type. An error is the catchable exception of the
// calculation, not a runtime error as in a comparison of data objects.

// CompareCalculated compares l with r, each an arithmetic expression or a numeric single operand (as Operand): -1,
// 0 or +1. The error is an *Exception.
func CompareCalculated(l, r Expr) (int, error) {
	values, ct, err := calculateTogether(l, r)
	if err != nil {
		return 0, err
	}
	return compareNum(ct, values[0], values[1]), nil
}

// MustCompareCalculated is CompareCalculated for generated code: an exception panics.
func MustCompareCalculated(l, r Expr) int {
	c, err := CompareCalculated(l, r)
	if err != nil {
		panic(err)
	}
	return c
}

// MustBetweenCalculated is x BETWEEN low AND high with arithmetic operands, for generated code: two comparisons,
// x >= low and x <= high, in one calculation type taken from all three operands. As with data objects, high is not
// evaluated when x is less than low. An exception panics.
func MustBetweenCalculated(x, low, high Expr) bool {
	ct := calculationTypeOf(x, low, high)
	vx, vlow := mustComparand(x, ct), mustComparand(low, ct)
	if compareNum(ct, vx, vlow) < 0 {
		return false
	}
	return compareNum(ct, vx, mustComparand(high, ct)) <= 0
}

func calculationTypeOf(es ...Expr) CalcType {
	var s scanState
	for _, e := range es {
		e.scan(&s)
	}
	return s.calcType()
}

// calculateTogether calculates each expression, from left to right, in the calculation type of all of them.
func calculateTogether(es ...Expr) ([]num, CalcType, error) {
	ct := calculationTypeOf(es...)
	values := make([]num, len(es))
	for k, e := range es {
		n, err := comparand(e, ct)
		if err != nil {
			return nil, ct, err
		}
		values[k] = n
	}
	return values, ct, nil
}

// comparand is the value of e in the calculation type ct, as a comparison compares it.
func comparand(e Expr, ct CalcType) (num, error) {
	n, err := evaluate(e, ct, false)
	if err != nil {
		return n, err
	}
	if ct == CalcP {
		// a p result is a number of at most 31 digits and at most 14 decimals, as for a text target
		n.d, err = pComparand(n.d)
	}
	return n, err
}

func mustComparand(e Expr, ct CalcType) num {
	n, err := comparand(e, ct)
	if err != nil {
		panic(err)
	}
	return n
}

// pComparand rounds a result of calculation type p to the decimals it keeps; more than 31 digits before the point
// overflow.
func pComparand(d decimal) (decimal, error) {
	limit, err := pTextLimit(d)
	if err != nil {
		return d, err
	}
	if -d.exp > limit {
		d = d.roundAway(-limit)
	}
	return d, nil
}

func compareNum(ct CalcType, x, y num) int {
	switch ct {
	case CalcI, CalcInt8:
		return cmpInt(x.i, y.i)
	case CalcF:
		return cmpFloat(x.f, y.f)
	}
	return decCompare(x.d, y.d)
}
