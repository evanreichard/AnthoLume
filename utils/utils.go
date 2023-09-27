package utils

type UTCOffset struct {
	Name  string
	Value string
}

var UTC_OFFSETS = []UTCOffset{
	{Value: "-12 hours", Name: "UTC−12:00"},
	{Value: "-11 hours", Name: "UTC−11:00"},
	{Value: "-10 hours", Name: "UTC−10:00"},
	{Value: "-9.5 hours", Name: "UTC−09:30"},
	{Value: "-9 hours", Name: "UTC−09:00"},
	{Value: "-8 hours", Name: "UTC−08:00"},
	{Value: "-7 hours", Name: "UTC−07:00"},
	{Value: "-6 hours", Name: "UTC−06:00"},
	{Value: "-5 hours", Name: "UTC−05:00"},
	{Value: "-4 hours", Name: "UTC−04:00"},
	{Value: "-3.5 hours", Name: "UTC−03:30"},
	{Value: "-3 hours", Name: "UTC−03:00"},
	{Value: "-2 hours", Name: "UTC−02:00"},
	{Value: "-1 hours", Name: "UTC−01:00"},
	{Value: "0 hours", Name: "UTC±00:00"},
	{Value: "+1 hours", Name: "UTC+01:00"},
	{Value: "+2 hours", Name: "UTC+02:00"},
	{Value: "+3 hours", Name: "UTC+03:00"},
	{Value: "+3.5 hours", Name: "UTC+03:30"},
	{Value: "+4 hours", Name: "UTC+04:00"},
	{Value: "+4.5 hours", Name: "UTC+04:30"},
	{Value: "+5 hours", Name: "UTC+05:00"},
	{Value: "+5.5 hours", Name: "UTC+05:30"},
	{Value: "+5.75 hours", Name: "UTC+05:45"},
	{Value: "+6 hours", Name: "UTC+06:00"},
	{Value: "+6.5 hours", Name: "UTC+06:30"},
	{Value: "+7 hours", Name: "UTC+07:00"},
	{Value: "+8 hours", Name: "UTC+08:00"},
	{Value: "+8.75 hours", Name: "UTC+08:45"},
	{Value: "+9 hours", Name: "UTC+09:00"},
	{Value: "+9.5 hours", Name: "UTC+09:30"},
	{Value: "+10 hours", Name: "UTC+10:00"},
	{Value: "+10.5 hours", Name: "UTC+10:30"},
	{Value: "+11 hours", Name: "UTC+11:00"},
	{Value: "+12 hours", Name: "UTC+12:00"},
	{Value: "+12.75 hours", Name: "UTC+12:45"},
	{Value: "+13 hours", Name: "UTC+13:00"},
	{Value: "+14 hours", Name: "UTC+14:00"},
}

func GetUTCOffsets() []UTCOffset {
	return UTC_OFFSETS
}
