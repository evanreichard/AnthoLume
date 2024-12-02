// Code generated by sqlc. DO NOT EDIT.
// versions:
//   sqlc v1.27.0

package database

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
	Basepath    *string `json:"basepath"`
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
	DocumentID         string  `json:"document_id"`
	UserID             string  `json:"user_id"`
	Percentage         float64 `json:"percentage"`
	LastRead           string  `json:"last_read"`
	LastSeen           string  `json:"last_seen"`
	ReadPercentage     float64 `json:"read_percentage"`
	TotalTimeSeconds   int64   `json:"total_time_seconds"`
	TotalWordsRead     int64   `json:"total_words_read"`
	TotalWpm           float64 `json:"total_wpm"`
	YearlyTimeSeconds  int64   `json:"yearly_time_seconds"`
	YearlyWordsRead    int64   `json:"yearly_words_read"`
	YearlyWpm          float64 `json:"yearly_wpm"`
	MonthlyTimeSeconds int64   `json:"monthly_time_seconds"`
	MonthlyWordsRead   int64   `json:"monthly_words_read"`
	MonthlyWpm         float64 `json:"monthly_wpm"`
	WeeklyTimeSeconds  int64   `json:"weekly_time_seconds"`
	WeeklyWordsRead    int64   `json:"weekly_words_read"`
	WeeklyWpm          float64 `json:"weekly_wpm"`
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

type Setting struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Value     string `json:"value"`
	CreatedAt string `json:"created_at"`
}

type User struct {
	ID        string  `json:"id"`
	Pass      *string `json:"-"`
	AuthHash  *string `json:"auth_hash"`
	Admin     bool    `json:"-"`
	Timezone  *string `json:"timezone"`
	CreatedAt string  `json:"created_at"`
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
	LastTimezone           string `json:"last_timezone"`
	LastSeen               string `json:"last_seen"`
	LastRecord             string `json:"last_record"`
	LastCalculated         string `json:"last_calculated"`
}
