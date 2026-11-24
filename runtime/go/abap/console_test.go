package abap

import (
	"strings"
	"testing"
)

func TestConsoleWrite(t *testing.T) {
	var b strings.Builder
	c := &Console{out: &b}
	c.Write("Hello", "")
	if got, want := b.String(), "Hello\n"; got != want {
		t.Fatalf("got %q, want %q after the first write", got, want)
	}
	c.Write("1", "n").Write("", "")
	if got, want := b.String(), "Hello\nn = 1\n\n"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
