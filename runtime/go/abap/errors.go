package abap

// Exception is a class-based exception raised by a statement, such as CX_SY_CONVERSION_OVERFLOW. Generated code
// panics with it; a TRY that catches the class recovers it, otherwise the program ends with a runtime error.
type Exception struct {
	// Class is the exception class name, upper case.
	Class string
}

func (e *Exception) Error() string { return e.Class }

// RuntimeError ends the program and cannot be caught, such as MOVE_NOT_SUPPORTED.
type RuntimeError struct {
	// Name is the runtime error, upper case.
	Name string
	// Text describes the cause.
	Text string
}

func (e *RuntimeError) Error() string { return e.Name + ": " + e.Text }

// The exceptions of the conversion rules.
const (
	CxConversionNoNumber     = "CX_SY_CONVERSION_NO_NUMBER"
	CxConversionOverflow     = "CX_SY_CONVERSION_OVERFLOW"
	CxConversionNoDateTime   = "CX_SY_CONVERSION_NO_DATE_TIME"
	CxConversionNotSupported = "CX_SY_CONVERSION_NOT_SUPPORTED"
)

var (
	errNoNumber     = &Exception{Class: CxConversionNoNumber}
	errOverflow     = &Exception{Class: CxConversionOverflow}
	errNoDateTime   = &Exception{Class: CxConversionNoDateTime}
	errNotSupported = &Exception{Class: CxConversionNotSupported}
)

// The exceptions of arithmetic expressions.
const (
	CxArithmeticOverflow = "CX_SY_ARITHMETIC_OVERFLOW"
	CxZerodivide         = "CX_SY_ZERODIVIDE"
	CxArgOutOfDomain     = "CX_SY_ARG_OUT_OF_DOMAIN"
	CxConversionRounding = "CX_SY_CONVERSION_ROUNDING"
)

var (
	errArithmeticOverflow = &Exception{Class: CxArithmeticOverflow}
	errZerodivide         = &Exception{Class: CxZerodivide}
	errArgOutOfDomain     = &Exception{Class: CxArgOutOfDomain}
	errRounding           = &Exception{Class: CxConversionRounding}
)
