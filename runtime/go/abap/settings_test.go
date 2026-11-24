package abap

import (
	"strings"
	"testing"
)

const setupFile = `{
  "users": [
    { "user": "alice", "dateFormat": "2", "decimalNotation": "X", "timeZone": "EST" },
    { "user": "BOB", "language": "D", "dateFormat": "4", "decimalNotation": "Y", "timeFormat": "0" }
  ]
}`

func TestUserSetup(t *testing.T) {
	alice, err := parseUserSetup([]byte(setupFile), "ALICE")
	if err != nil {
		t.Fatal(err)
	}
	want := Settings{User: "ALICE", Language: "E", DateFormat: '2', DecimalNotation: 'X', TimeFormat: '0', TimeZone: "EST"}
	if alice != want {
		t.Errorf("alice: got %+v, want %+v", alice, want)
	}
	bob, err := parseUserSetup([]byte(setupFile), "bob")
	if err != nil {
		t.Fatal(err)
	}
	want = Settings{User: "BOB", Language: "D", DateFormat: '4', DecimalNotation: 'Y', TimeFormat: '0', TimeZone: "UTC"}
	if bob != want {
		t.Errorf("bob: got %+v, want %+v", bob, want)
	}
	one, err := parseUserSetup([]byte(`{"users": [{"user": "carol"}]}`), "")
	if err != nil {
		t.Fatal(err)
	}
	if want := (Settings{User: "CAROL", Language: "E", DateFormat: '1', DecimalNotation: ' ', TimeFormat: '0', TimeZone: "UTC"}); one != want {
		t.Errorf("carol: got %+v, want %+v", one, want)
	}
}

func TestUserSetupRefused(t *testing.T) {
	cases := []struct{ file, user, err string }{
		{setupFile, "", "2 users, name one with --user"},
		{setupFile, "DAVE", "no user DAVE"},
		{`{"users": [{"user": "a", "dateFormat": "7"}]}`, "", "date format 7 is not supported yet"},
		{`{"users": [{"user": "a", "dateFormat": "0"}]}`, "", "is not a date format"},
		{`{"users": [{"user": "a", "decimalNotation": "Z"}]}`, "", "is not a decimal notation"},
		{`{"users": [{"user": "a", "timeFormat": "1"}]}`, "", "time format 1 is not supported yet"},
		{`{"users": [{"user": "a", "datfm": "1"}]}`, "", "unknown field"},
		{`{"users": [{"dateFormat": "1"}]}`, "", "has no user"},
	}
	for _, c := range cases {
		_, err := parseUserSetup([]byte(c.file), c.user)
		if err == nil || !strings.Contains(err.Error(), c.err) {
			t.Errorf("%s / %q: got %v, want %q", c.file, c.user, err, c.err)
		}
	}
}

func TestSessionFromArgs(t *testing.T) {
	s, err := sessionFromArgs(nil)
	if err != nil || s.Settings != DefaultSettings {
		t.Errorf("no arguments: %+v, %v", s, err)
	}
	for _, args := range [][]string{{"--user", "A"}, {"--user-setup"}, {"-x", "1"}} {
		if _, err := sessionFromArgs(args); err == nil {
			t.Errorf("%v: no error", args)
		}
	}
}
