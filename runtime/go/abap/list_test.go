package abap

import (
	"strings"
	"testing"
)

func TestListGap(t *testing.T) {
	var b strings.Builder
	l := newList(&b, 0)
	l.Write("it's", false)
	l.Write("str", false)
	l.Write("x", true)
	l.Write("y", false)
	l.End()
	if got, want := b.String(), "it's str\nx y\n"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// A finished line is on the output before the program ends.
func TestListStreamsFinishedLines(t *testing.T) {
	var b strings.Builder
	l := newList(&b, 0)
	l.Write("a", false)
	if b.String() != "" {
		t.Fatalf("an unfinished line was written: %q", b.String())
	}
	l.Write("b", true)
	if got, want := b.String(), "a\n"; got != want {
		t.Fatalf("got %q, want %q before End", got, want)
	}
	l.End()
	if got, want := b.String(), "a\nb\n"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// WRITE / on an empty line starts no line, and an empty list writes nothing.
func TestListNewLineOnEmptyLine(t *testing.T) {
	var b strings.Builder
	l := newList(&b, 0)
	l.Write("a", true)
	l.End()
	l.End()
	if got, want := b.String(), "a\n"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// No wrap at the list width, as in open-abap-gui's list processor.
func TestListNoWrap(t *testing.T) {
	var b strings.Builder
	l := newList(&b, 10)
	l.Write("Hello", false)
	l.Write("World", false)
	l.End()
	if got, want := b.String(), "Hello World\n"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
