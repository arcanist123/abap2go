package abap

// The console of an IF_OO_ADT_CLASSRUN root: the object passed as OUT to IF_OO_ADT_CLASSRUN~MAIN.
//
// WRITE of an elementary value follows open-steamgate's ZCL_OSD_CLASSRUN_OUT (src/classrun/zcl_osd_classrun_out.clas.abap,
// Copyright (c) 2026 Alice Vinogradova and contributors, MIT License, see LICENSES/open-steamgate.txt): one line per
// WRITE, the value converted to a string, `name = value` when NAME is supplied and not initial. Unlike that class,
// which keeps the lines and hands them over at the end, each line goes to standard output at once.
// Structures and tables are not supported yet; the compiler only passes text.

import (
	"io"
	"os"
)

// Console implements IF_OO_ADT_CLASSRUN_OUT.
type Console struct {
	out io.Writer
}

// NewConsole creates the console writing to standard output.
func NewConsole() *Console {
	return &Console{out: os.Stdout}
}

// Write is IF_OO_ADT_CLASSRUN_OUT~WRITE for a value already converted to a string (ABAP text, see text.go). name is
// "" when NAME is not supplied or initial.
func (c *Console) Write(value string, name string) *Console {
	if name != "" {
		writeLine(c.out, ToUTF8(name)+" = "+ToUTF8(value))
	} else {
		writeLine(c.out, ToUTF8(value))
	}
	return c
}
