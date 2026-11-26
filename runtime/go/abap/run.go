package abap

import (
	"errors"
	"fmt"
	"io"
	"os"
)

// Usage is the command line of a compiled root.
const Usage = "usage: <program> [--user-setup <file> [--user <name>]]"

// Run runs a compiled root in a session for the user the command line names (the default settings without
// arguments). An exception nobody catches, or a runtime error, ends the program as a runtime error does in ABAP:
// what was already written stays written, a message goes to standard error and the exit code is 1. A command line
// or user setup that cannot be used ends it with exit code 2 before the root runs.
func Run(root func(session *Session)) {
	session, err := sessionFromArgs(os.Args[1:])
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n%s\n", err, Usage)
		os.Exit(2)
	}
	if err := run(root, session); err != nil {
		reportRuntimeError(os.Stderr, err)
		os.Exit(1)
	}
}

func run(root func(session *Session), session *Session) (err error) {
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
	root(session)
	return nil
}

func reportRuntimeError(w io.Writer, err error) {
	var exc *Exception
	if errors.As(err, &exc) {
		where := ""
		if exc.uncaught {
			where = " in a CLEANUP block"
		}
		fmt.Fprintf(w, "runtime error: exception %s not caught%s\n", exc.Class, where)
		return
	}
	fmt.Fprintf(w, "runtime error: %v\n", err)
}
