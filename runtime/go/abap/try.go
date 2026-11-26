package abap

// TRY ... CATCH ... CLEANUP ... ENDTRY, and the statements whose exception leaves a value in their target.
//
// An exception is a panic with an *Exception. Each TRY that is running has a frame on the session's handler stack:
// the classes of its CATCH clauses. Whether anything handles an exception is decided before any CLEANUP runs, as
// ABAP decides it where the exception is raised: an exception no frame catches ends the program without running a
// CLEANUP block, and one that is caught further out runs the CLEANUP blocks of the TRYs it leaves, innermost first,
// before its CATCH block. A runtime error (*RuntimeError) is never caught and runs no CLEANUP.

import (
	"fmt"
	"math"
)

// Retry is the jump a CATCH block returns for RETRY: the TRY block runs again.
const Retry = "retry"

// Try runs one TRY control structure and returns the jump that left it ("" when it ended normally).
//
// body is the TRY block. catches holds, per CATCH clause in order, the exception classes it catches: the classes
// named and all their subclasses, upper case. handler runs CATCH clause k with the exception; cleanup is the
// CLEANUP block, nil without one. body and handler return "" to go on after ENDTRY, Retry (handler only) to run the
// TRY block again, or a jump of the generated code (EXIT, CONTINUE or CHECK of a loop outside the TRY), which Try
// returns.
//
// sy-index is set back to its value at the start of the TRY block before a CATCH or CLEANUP block runs, and when
// RETRY runs it again: an exception or a RETRY that leaves a loop sets it back as the end of the loop does, and only
// loops change it.
func (s *Session) Try(body func() string, catches [][]string, handler func(k int) string, cleanup func()) string {
	index := s.Sy.Index
	for {
		k, jump := s.tryBlock(body, catches, cleanup)
		if k < 0 {
			return jump
		}
		if jump = handler(k); jump != Retry {
			return jump
		}
		s.Sy.Index = index
	}
}

// tryBlock runs the TRY block: k is the CATCH clause that caught an exception, -1 if none was raised.
func (s *Session) tryBlock(body func() string, catches [][]string, cleanup func()) (k int, jump string) {
	index := s.Sy.Index
	depth := len(s.handlers)
	s.handlers = append(s.handlers, catches)
	defer func() {
		s.handlers = s.handlers[:depth]
		r := recover()
		if r == nil {
			return
		}
		e, ok := r.(*Exception)
		if !ok || e.uncaught {
			panic(r)
		}
		k = catching(catches, e.Class)
		if k < 0 && !s.handled(e.Class) {
			panic(e) // nobody catches it: the program ends, no CLEANUP runs
		}
		if e.gap != "" {
			panic(&RuntimeError{Name: "SPECIAL_VALUE_NOT_SUPPORTED",
				Text: fmt.Sprintf("exception %s leaves %s, which is not supported yet", e.Class, e.gap)})
		}
		s.Sy.Index = index
		if k < 0 {
			s.cleanup(cleanup)
			panic(e)
		}
	}()
	return -1, body()
}

// cleanup runs a CLEANUP block. The handlers of the TRYs around it do not apply inside it: an exception it does
// not handle itself ends the program.
func (s *Session) cleanup(cleanup func()) {
	if cleanup == nil {
		return
	}
	saved := s.handlers
	s.handlers = nil
	defer func() {
		s.handlers = saved
		if r := recover(); r != nil {
			if e, ok := r.(*Exception); ok {
				panic(&Exception{Class: e.Class, uncaught: true})
			}
			panic(r)
		}
	}()
	cleanup()
}

// handled tells whether a running TRY catches class.
func (s *Session) handled(class string) bool {
	for _, catches := range s.handlers {
		if catching(catches, class) >= 0 {
			return true
		}
	}
	return false
}

// catching is the first CATCH clause that catches class, -1 if none does.
func catching(catches [][]string, class string) int {
	for k, classes := range catches {
		for _, c := range classes {
			if c == class {
				return k
			}
		}
	}
	return -1
}

// Move is dst = v for a variable of type t: v of type src converted by the conversion rules. When the conversion
// raises an exception, the value it leaves (docs/spec/conversion.md, "The target after an exception") is stored
// first.
func Move[T any](dst *T, src Type, v any, t Type) {
	r, err := Convert(src, v, t)
	store(dst, r, err, t, src.Kind == KindDecfloat34)
}

// MoveTo is Move for a target known as a setter, such as a subfield.
func MoveTo[T any](set func(T), src Type, v any, t Type) {
	r, err := Convert(src, v, t)
	storeTo(set, r, err, t, src.Kind == KindDecfloat34)
}

// Compute is dst = e for a result field of type t, storing the value an exception leaves first, as Move does.
func Compute[T any](dst *T, e Expr, t Type) {
	r, err := Calculate(e, t)
	store(dst, r, err, t, err != nil && CalculationType(e, t) == CalcDecfloat34)
}

// ComputeTo is Compute for a target known as a setter, such as a subfield.
func ComputeTo[T any](set func(T), e Expr, t Type) {
	r, err := Calculate(e, t)
	storeTo(set, r, err, t, err != nil && CalculationType(e, t) == CalcDecfloat34)
}

func store[T any](dst *T, r any, err error, t Type, fromDecfloat34 bool) {
	if err == nil {
		*dst = r.(T)
		return
	}
	r, err = special(r, err, t, fromDecfloat34)
	if r != nil {
		*dst = r.(T)
	}
	panic(err)
}

func storeTo[T any](set func(T), r any, err error, t Type, fromDecfloat34 bool) {
	if err == nil {
		set(r.(T))
		return
	}
	r, err = special(r, err, t, fromDecfloat34)
	if r != nil {
		set(r.(T))
	}
	panic(err)
}

// special holds back a value the runtime does not support yet (docs/spec/conversion.md, "Known gaps"): +Inf, -Inf
// or NaN left in an f field, and the infinity a decfloat34 value too large for decfloat16 leaves there, which the
// runtime cannot hold yet. The exception then carries the gap, and Try turns it into a runtime error if anything
// would see the field; uncaught, it ends the program as the exception would.
func special(r any, err error, t Type, fromDecfloat34 bool) (any, error) {
	e, ok := err.(*Exception)
	if !ok {
		return r, err
	}
	if f, ok := r.(float64); ok && (math.IsInf(f, 0) || math.IsNaN(f)) {
		return nil, &Exception{Class: e.Class, gap: "+Inf, -Inf or NaN in an f field"}
	}
	if r == nil && t.Kind == KindDecfloat16 && fromDecfloat34 && e.Class == CxConversionOverflow {
		return nil, &Exception{Class: e.Class, gap: "an infinity in a decfloat16 field"}
	}
	return r, err
}
