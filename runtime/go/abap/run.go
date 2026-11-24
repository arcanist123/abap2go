package abap

import (
	"errors"
	"fmt"
	"io"
	"os"
)

// Run runs a compiled root. An exception nobody catches, or a runtime error, ends the program as a runtime error
// does in ABAP: what was already written stays written, a message goes to standard error and the exit code is 1.
func Run(root func()) {
	if err := run(root); err != nil {
		reportRuntimeError(os.Stderr, err)
		os.Exit(1)
	}
}

func run(root func()) (err error) {
	defer func() {
		if r := recover(); r != nil {
			var exc *Exception
			var rte *RuntimeError
			if e, ok := r.(error); ok && (errors.As(e, &exc) || errors.As(e, &rte)) {
				err = e
				return
			}
			panic(r)
		}
	}()
	root()
	return nil
}

func reportRuntimeError(w io.Writer, err error) {
	var exc *Exception
	if errors.As(err, &exc) {
		fmt.Fprintf(w, "runtime error: exception %s not caught\n", exc.Class)
		return
	}
	fmt.Fprintf(w, "runtime error: %v\n", err)
}
