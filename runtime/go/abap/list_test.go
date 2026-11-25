package abap

import (
	"strings"
	"testing"
)

func TestListGap(t *testing.T) {
	var b strings.Builder
	l := newList(&b, 0)
	l.Write(FromUTF8("it's"), false)
	l.Write(FromUTF8("str"), false)
	l.Write(FromUTF8("x"), true)
	l.Write(FromUTF8("y"), false)
	l.End()
	if got, want := b.String(), "it's str\nx y\n"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// A finished line is on the output before the program ends.
func TestListStreamsFinishedLines(t *testing.T) {
	var b strings.Builder
	l := newList(&b, 0)
	l.Write(FromUTF8("a"), false)
	if b.String() != "" {
		t.Fatalf("an unfinished line was written: %q", b.String())
	}
	l.Write(FromUTF8("b"), true)
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
	l.Write(FromUTF8("a"), true)
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
	l.Write(FromUTF8("Hello"), false)
	l.Write(FromUTF8("World"), false)
	l.End()
	if got, want := b.String(), "Hello World\n"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// An empty output at the start of a line still gets the blank after it; a line of blanks only is not output.
func TestListEmptyAndBlankOutputs(t *testing.T) {
	var b strings.Builder
	l := newList(&b, 0)
	l.Write(FromUTF8(""), false)
	l.Write(FromUTF8("b"), false)
	l.Write(FromUTF8(" "), true)
	l.Write(FromUTF8("x"), true)
	l.Write(FromUTF8("a "), false)
	l.Write(FromUTF8("b"), false)
	l.End()
	if got, want := b.String(), " b\nx a  b\n"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
