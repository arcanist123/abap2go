package abap

// ABAP's calendar for d and utclong: Gregorian from 1582-10-15, Julian before. A day number counts days since
// 0001-01-01 (day 0), which is the Julian Day Number minus 1721424. For d, the ten days 1582-10-05 to -14 that the
// Gregorian reform skipped are valid Julian dates and fall on the same day numbers as 1582-10-15 to -24; utclong
// refuses them.

import "fmt"

const (
	jdnDay0      = 1721424 // 0001-01-01 on the Julian calendar
	jdnGregorian = 2299161 // 1582-10-15, the first Gregorian day
	maxDayNumber = 3652060 // 9999-12-31
)

func gregorianLeap(y int) bool { return y%4 == 0 && (y%100 != 0 || y%400 == 0) }

func isGregorian(y, m, d int) bool {
	return y > 1582 || y == 1582 && (m > 10 || m == 10 && d >= 15)
}

func monthDays(y, m int, gregorian bool) int {
	switch m {
	case 2:
		leap := y%4 == 0
		if gregorian {
			leap = gregorianLeap(y)
		}
		if leap {
			return 29
		}
		return 28
	case 4, 6, 9, 11:
		return 30
	}
	return 31
}

// validDate reports whether y-m-d is a date of ABAP's calendar (the reform gap included, as for d).
func validDate(y, m, d int) bool {
	return y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= monthDays(y, m, isGregorian(y, m, d))
}

// dayNumber of a valid date.
func dayNumber(y, m, d int) int {
	a := (14 - m) / 12
	yy := y + 4800 - a
	mm := m + 12*a - 3
	var jdn int
	if isGregorian(y, m, d) {
		jdn = d + (153*mm+2)/5 + 365*yy + yy/4 - yy/100 + yy/400 - 32045
	} else {
		jdn = d + (153*mm+2)/5 + 365*yy + yy/4 - 32083
	}
	return jdn - jdnDay0
}

// dateOf a day number >= 0.
func dateOf(n int) (y, m, d int) {
	jdn := n + jdnDay0
	var c, dd, e int
	if jdn >= jdnGregorian {
		a := jdn + 32044
		b := (4*a + 3) / 146097
		c = a - 146097*b/4
		dd = (4*c + 3) / 1461
		e = c - 1461*dd/4
		mm := (5*e + 2) / 153
		return 100*b + dd - 4800 + mm/10, mm + 3 - 12*(mm/10), e - (153*mm+2)/5 + 1
	}
	c = jdn + 32082
	dd = (4*c + 3) / 1461
	e = c - 1461*dd/4
	mm := (5*e + 2) / 153
	return dd - 4800 + mm/10, mm + 3 - 12*(mm/10), e - (153*mm+2)/5 + 1
}

// digitsValue is the value of s if it consists of ASCII digits only.
func digitsValue(s string) (int, bool) {
	if s == "" {
		return 0, false
	}
	v := 0
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
		v = v*10 + int(s[i]-'0')
	}
	return v, true
}

// dDayNumber is the day number of a d value, 0 if it is not a valid date.
func dDayNumber(s string) int {
	if len(s) != 8 {
		return 0
	}
	y, ok1 := digitsValue(s[:4])
	m, ok2 := digitsValue(s[4:6])
	d, ok3 := digitsValue(s[6:])
	if !ok1 || !ok2 || !ok3 || !validDate(y, m, d) {
		return 0
	}
	return dayNumber(y, m, d)
}

// dFromDayNumber is the d value of day number n: 00000000 outside 1 to 9999-12-31.
func dFromDayNumber(n int64) string {
	if n < 1 || n > maxDayNumber {
		return "00000000"
	}
	y, m, d := dateOf(int(n))
	return fmt.Sprintf("%04d%02d%02d", y, m, d)
}

// tSeconds is the number of seconds of a t value, hh*3600+mm*60+ss without range checks, 0 if not all digits.
func tSeconds(s string) int {
	if len(s) != 6 {
		return 0
	}
	h, ok1 := digitsValue(s[:2])
	m, ok2 := digitsValue(s[2:4])
	sec, ok3 := digitsValue(s[4:])
	if !ok1 || !ok2 || !ok3 {
		return 0
	}
	return h*3600 + m*60 + sec
}

// tFromSeconds is the t value of n seconds, taken modulo one day.
func tFromSeconds(n int64) string {
	n %= 86400
	if n < 0 {
		n += 86400
	}
	return fmt.Sprintf("%02d%02d%02d", n/3600, n/60%60, n%60)
}
