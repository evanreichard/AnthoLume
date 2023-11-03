// Code generated by sqlc. DO NOT EDIT.
// versions:
//   sqlc v1.21.0

package database

import (
	"database/sql"
)

type Activity struct {
	ID              int64   `json:"id"`
	UserID          string  `json:"user_id"`
	DocumentID      string  `json:"document_id"`
	DeviceID        string  `json:"device_id"`
	StartTime       string  `json:"start_time"`
	StartPercentage float64 `json:"start_percentage"`
	EndPercentage   float64 `json:"end_percentage"`
	Duration        int64   `json:"duration"`
	CreatedAt       string  `json:"created_at"`
}

type Device struct {
	ID         string `json:"id"`
	UserID     string `json:"user_id"`
	DeviceName string `json:"device_name"`
	LastSynced string `json:"last_synced"`
	CreatedAt  string `json:"created_at"`
	Sync       bool   `json:"sync"`
}

type Document struct {
	ID          string  `json:"id"`
	Md5         *string `json:"md5"`
	Filepath    *string `json:"filepath"`
	Coverfile   *string `json:"coverfile"`
	Title       *string `json:"title"`
	Author      *string `json:"author"`
	Series      *string `json:"series"`
	SeriesIndex *int64  `json:"series_index"`
	Lang        *string `json:"lang"`
	Description *string `json:"description"`
	Words       *int64  `json:"words"`
	Gbid        *string `json:"gbid"`
	Olid        *string `json:"-"`
	Isbn10      *string `json:"isbn10"`
	Isbn13      *string `json:"isbn13"`
	Synced      bool    `json:"-"`
	Deleted     bool    `json:"-"`
	UpdatedAt   string  `json:"updated_at"`
	CreatedAt   string  `json:"created_at"`
}

type DocumentProgress struct {
	UserID     string  `json:"user_id"`
	DocumentID string  `json:"document_id"`
	DeviceID   string  `json:"device_id"`
	Percentage float64 `json:"percentage"`
	Progress   string  `json:"progress"`
	CreatedAt  string  `json:"created_at"`
}

type DocumentUserStatistic struct {
	DocumentID       string  `json:"document_id"`
	UserID           string  `json:"user_id"`
	LastRead         string  `json:"last_read"`
	TotalTimeSeconds int64   `json:"total_time_seconds"`
	ReadPercentage   float64 `json:"read_percentage"`
	Percentage       float64 `json:"percentage"`
	WordsRead        int64   `json:"words_read"`
	Wpm              float64 `json:"wpm"`
}

type Metadatum struct {
	ID          int64   `json:"id"`
	DocumentID  string  `json:"document_id"`
	Title       *string `json:"title"`
	Author      *string `json:"author"`
	Description *string `json:"description"`
	Gbid        *string `json:"gbid"`
	Olid        *string `json:"olid"`
	Isbn10      *string `json:"isbn10"`
	Isbn13      *string `json:"isbn13"`
	CreatedAt   string  `json:"created_at"`
}

type User struct {
	ID         string  `json:"id"`
	Pass       *string `json:"-"`
	Admin      bool    `json:"-"`
	TimeOffset *string `json:"time_offset"`
	CreatedAt  string  `json:"created_at"`
}

type UserStreak struct {
	UserID                 string `json:"user_id"`
	Window                 string `json:"window"`
	MaxStreak              int64  `json:"max_streak"`
	MaxStreakStartDate     string `json:"max_streak_start_date"`
	MaxStreakEndDate       string `json:"max_streak_end_date"`
	CurrentStreak          int64  `json:"current_streak"`
	CurrentStreakStartDate string `json:"current_streak_start_date"`
	CurrentStreakEndDate   string `json:"current_streak_end_date"`
}

type ViewDocumentUserStatistic struct {
	DocumentID       string          `json:"document_id"`
	UserID           string          `json:"user_id"`
	LastRead         interface{}     `json:"last_read"`
	TotalTimeSeconds sql.NullFloat64 `json:"total_time_seconds"`
	ReadPercentage   sql.NullFloat64 `json:"read_percentage"`
	Percentage       float64         `json:"percentage"`
	WordsRead        interface{}     `json:"words_read"`
	Wpm              int64           `json:"wpm"`
}

type ViewUserStreak struct {
	UserID                 string      `json:"user_id"`
	Window                 string      `json:"window"`
	MaxStreak              interface{} `json:"max_streak"`
	MaxStreakStartDate     interface{} `json:"max_streak_start_date"`
	MaxStreakEndDate       interface{} `json:"max_streak_end_date"`
	CurrentStreak          interface{} `json:"current_streak"`
	CurrentStreakStartDate interface{} `json:"current_streak_start_date"`
	CurrentStreakEndDate   interface{} `json:"current_streak_end_date"`
}
