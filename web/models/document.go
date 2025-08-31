package models

import (
	"time"

	"reichard.io/antholume/metadata"
)

type Document struct {
	ID             string
	ISBN10         string
	ISBN13         string
	Title          string
	Author         string
	Description    string
	Percentage     float64
	WPM            int64
	Words          *int64
	TotalTimeRead  time.Duration
	TimePerPercent time.Duration
	HasFile        bool
}

type DocumentMetadata struct {
	SourceID    string
	ISBN10      string
	ISBN13      string
	Title       string
	Author      string
	Description string
	Source      metadata.Source
}
