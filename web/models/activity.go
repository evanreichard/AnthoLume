package models

import "time"

type Activity struct {
	ID         string
	Author     string
	Title      string
	StartTime  string
	Duration   time.Duration
	Percentage float64
}
