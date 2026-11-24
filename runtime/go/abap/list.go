// Package abap is the runtime that compiled ABAP programs link against.
package abap

// The list layout is ported from open-abap-gui's classic list processor, ZCL_GG_HOST_LIST
// (framework/host/zcl_gg_host_list.clas.abap, open-abap/open-abap-gui at 783adfc, methods write_at, place,
// end_line, flush, line_size), the list processor open-steamgate uses for native reports.
// Copyright (c) 2022 Heliconia Labs, MIT License, see LICENSES/open-abap-gui.txt.
//
// Modelled so far: placement, the gap between fields, WRITE /, trailing blanks removed per line.
// Not yet ported: positions and lengths, NO-GAP, justification, ULINE, SKIP, NEW-LINE, pages and their events.
// As in the original, a line is never wrapped at the list width, and lengths count characters.
//
// Unlike the original, which keeps the list and hands it over when the program ends, a line goes to standard
// output as soon as it is finished: layout only ever looks at the current line, so a finished line never changes.
// Statements that read or change earlier lines (READ LINE, MODIFY LINE) are refused at build time.

import (
	"io"
	"os"
)

// DefaultLineSize is the list width when the program sets no LINE-SIZE (open-abap-gui's default_line_size).
const DefaultLineSize = 132

// List is the basic list of an executable program.
type List struct {
	out      io.Writer
	lineSize int
	current  []rune
	column   int // 1-based, where the next output goes before the gap rule
}

// NewList creates an empty basic list writing to standard output. lineSize 0 means no LINE-SIZE was given.
func NewList(lineSize int) *List {
	return newList(os.Stdout, lineSize)
}

func newList(out io.Writer, lineSize int) *List {
	if lineSize <= 0 {
		lineSize = DefaultLineSize
	}
	return &List{out: out, lineSize: lineSize, column: 1}
}

// LineSize is the list width (used by ULINE once it is supported).
func (l *List) LineSize() int {
	return l.lineSize
}

// Write outputs text: on a new line if newLine (WRITE /), else one blank after the previous output of the line.
func (l *List) Write(text string, newLine bool) {
	if newLine {
		l.endLine()
	}
	if l.column > 1 {
		l.column++
	}
	l.place(text)
}

// End finishes the list when the program ends: the current line, if it has output, is written.
func (l *List) End() {
	l.endLine()
}

func (l *List) place(text string) {
	for len(l.current) < l.column-1 {
		l.current = append(l.current, ' ')
	}
	l.current = append(l.current, []rune(text)...)
	l.column = len(l.current) + 1
}

func (l *List) endLine() {
	if len(l.current) == 0 && l.column <= 1 {
		return
	}
	l.flush()
}

func (l *List) flush() {
	n := len(l.current)
	for n > 0 && l.current[n-1] == ' ' {
		n--
	}
	writeLine(l.out, string(l.current[:n]))
	l.current = l.current[:0]
	l.column = 1
}

// writeLine writes one line at once, unbuffered, so it is visible while the program runs.
func writeLine(out io.Writer, line string) {
	if _, err := io.WriteString(out, line+"\n"); err != nil {
		panic(err)
	}
}
