package abap

// User settings and the session. What ABAP takes from the user master record (date format, decimal notation, ...)
// belongs to the user of a session, not to the process (see the decision in docs/aot_for_abap.md). Without a
// database the settings come from the user setup file, one record per user. Runtime code that depends on them
// takes them as a parameter and never reads a global.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// Settings are the user settings of a session. The codes are those of the user master record.
type Settings struct {
	// User is the user name, upper case.
	User string
	// Language is the logon language, a one-character language key such as E.
	Language string
	// DateFormat is the date format: '1' DD.MM.YYYY, '2' MM/DD/YYYY, '3' MM-DD-YYYY, '4' YYYY.MM.DD,
	// '5' YYYY/MM/DD, '6' YYYY-MM-DD. The Japanese, Islamic and Iranian formats are not supported yet.
	DateFormat byte
	// DecimalNotation is the decimal notation: ' ' 1.234.567,89, 'X' 1,234,567.89, 'Y' 1 234 567,89.
	DecimalNotation byte
	// TimeFormat is the time format: '0' 24 hours. The 12-hour formats are not supported yet.
	TimeFormat byte
	// TimeZone is the user's time zone, such as UTC or CET.
	TimeZone string
}

// DefaultSettings are the settings of a session when no user setup file is given: the initial values of the
// user master record, which mean DD.MM.YYYY and 1.234.567,89.
var DefaultSettings = Settings{User: "", Language: "E", DateFormat: '1', DecimalNotation: ' ', TimeFormat: '0', TimeZone: "UTC"}

// separators are the decimal separator and the thousands separator of the decimal notation.
func (s Settings) separators() (decimal, thousands byte) {
	switch s.DecimalNotation {
	case 'X':
		return '.', ','
	case 'Y':
		return ',', ' '
	}
	return ',', '.'
}

// Session is what a run of a root belongs to: one user and their settings.
type Session struct {
	Settings Settings
	Sy       Sy
	// handlers has a frame per running TRY, innermost last: the classes of its CATCH clauses (see Try).
	handlers [][][]string
}

// Sy holds the system fields of a session that compiled code sets and reads.
type Sy struct {
	// Index is sy-index: in DO and WHILE the number of the current pass, set before a WHILE condition is
	// evaluated; after the loop it is set back to the value it had before the loop. 0 at the start.
	Index int32
}

// userRecord is one user in the user setup file. Fields left out take the value of DefaultSettings.
type userRecord struct {
	User            string  `json:"user"`
	Language        *string `json:"language"`
	DateFormat      *string `json:"dateFormat"`
	DecimalNotation *string `json:"decimalNotation"`
	TimeFormat      *string `json:"timeFormat"`
	TimeZone        *string `json:"timeZone"`
}

type userSetup struct {
	Users []userRecord `json:"users"`
}

// LoadUserSetup reads the user setup file and returns the settings of user. user may be "" when the file has
// exactly one record.
func LoadUserSetup(file string, user string) (Settings, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return Settings{}, err
	}
	return parseUserSetup(data, user)
}

func parseUserSetup(data []byte, user string) (Settings, error) {
	var setup userSetup
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&setup); err != nil {
		return Settings{}, fmt.Errorf("user setup: %w", err)
	}
	user = strings.ToUpper(user)
	var found *userRecord
	for i := range setup.Users {
		r := &setup.Users[i]
		if r.User == "" {
			return Settings{}, fmt.Errorf("user setup: record %d has no user", i+1)
		}
		if strings.ToUpper(r.User) == user || user == "" && len(setup.Users) == 1 {
			found = r
		}
	}
	if found == nil {
		if user == "" {
			return Settings{}, fmt.Errorf("user setup: %d users, name one with --user", len(setup.Users))
		}
		return Settings{}, fmt.Errorf("user setup: no user %s", user)
	}
	return found.settings()
}

func (r *userRecord) settings() (Settings, error) {
	s := DefaultSettings
	s.User = strings.ToUpper(r.User)
	if r.Language != nil {
		if len(*r.Language) != 1 {
			return s, fmt.Errorf("user %s: language %q is not a one-character language key", s.User, *r.Language)
		}
		s.Language = strings.ToUpper(*r.Language)
	}
	if r.DateFormat != nil {
		switch v := *r.DateFormat; v {
		case "1", "2", "3", "4", "5", "6":
			s.DateFormat = v[0]
		case "7", "8", "9", "A", "B", "C":
			return s, fmt.Errorf("user %s: date format %s is not supported yet", s.User, v)
		default:
			return s, fmt.Errorf("user %s: date format %q is not a date format (1 to 9, A to C)", s.User, v)
		}
	}
	if r.DecimalNotation != nil {
		switch v := *r.DecimalNotation; v {
		case "", " ":
			s.DecimalNotation = ' '
		case "X", "Y":
			s.DecimalNotation = v[0]
		default:
			return s, fmt.Errorf("user %s: decimal notation %q is not a decimal notation (blank, X, Y)", s.User, v)
		}
	}
	if r.TimeFormat != nil {
		switch v := *r.TimeFormat; v {
		case "0":
		case "1", "2", "3", "4":
			return s, fmt.Errorf("user %s: time format %s is not supported yet", s.User, v)
		default:
			return s, fmt.Errorf("user %s: time format %q is not a time format (0 to 4)", s.User, v)
		}
	}
	if r.TimeZone != nil {
		if *r.TimeZone == "" {
			return s, fmt.Errorf("user %s: empty time zone", s.User)
		}
		s.TimeZone = *r.TimeZone
	}
	return s, nil
}

// sessionFromArgs is the session a command-line run asks for: --user-setup <file> [--user <name>], or the default
// settings without arguments.
func sessionFromArgs(args []string) (*Session, error) {
	file, user := "", ""
	for i := 0; i < len(args); i += 2 {
		if i+1 >= len(args) {
			return nil, fmt.Errorf("%s needs a value", args[i])
		}
		switch args[i] {
		case "--user-setup":
			file = args[i+1]
		case "--user":
			user = args[i+1]
		default:
			return nil, fmt.Errorf("unknown argument %s", args[i])
		}
	}
	if file == "" {
		if user != "" {
			return nil, fmt.Errorf("--user needs --user-setup")
		}
		return &Session{Settings: DefaultSettings}, nil
	}
	settings, err := LoadUserSetup(file, user)
	if err != nil {
		return nil, err
	}
	return &Session{Settings: settings}, nil
}
