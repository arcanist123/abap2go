package abap

import (
	"strings"
	"testing"
)

func TestConsoleWrite(t *testing.T) {
	var b strings.Builder
	c := &Console{out: &b}
	c.Write(FromUTF8("Hello"), FromUTF8(""))
	if got, want := b.String(), "Hello\n"; got != want {
		t.Fatalf("got %q, want %q after the first write", got, want)
	}
	c.Write(FromUTF8("1"), FromUTF8("n")).Write(FromUTF8(""), FromUTF8(""))
	if got, want := b.String(), "Hello\nn = 1\n\n"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
