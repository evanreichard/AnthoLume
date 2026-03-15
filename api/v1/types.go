package v1

import "reichard.io/antholume/database"

// DocumentsResponse is the API response for document list endpoints
type DocumentsResponse struct {
	Documents    []database.GetDocumentsWithStatsRow `json:"documents"`
	Total        int64               `json:"total"`
	Page         int64               `json:"page"`
	Limit        int64               `json:"limit"`
	NextPage     *int64              `json:"next_page"`
	PreviousPage *int64              `json:"previous_page"`
	Search       *string             `json:"search"`
	User         UserData            `json:"user"`
	WordCounts   []WordCount         `json:"word_counts"`
}

// DocumentResponse is the API response for single document endpoints
type DocumentResponse struct {
	Document database.Document `json:"document"`
	User     UserData          `json:"user"`
	Progress *Progress         `json:"progress"`
}

// UserData represents authenticated user context
type UserData struct {
	Username string `json:"username"`
	IsAdmin  bool   `json:"is_admin"`
}

// WordCount represents computed word count statistics
type WordCount struct {
	DocumentID string `json:"document_id"`
	Count      int64  `json:"count"`
}

// Progress represents reading progress for a document
type Progress struct {
	UserID     string  `json:"user_id"`
	DocumentID string  `json:"document_id"`
	DeviceID   string  `json:"device_id"`
	Percentage float64 `json:"percentage"`
	Progress   string  `json:"progress"`
	CreatedAt  string  `json:"created_at"`
}

// ActivityResponse is the API response for activity endpoints
type ActivityResponse struct {
	Activities []database.GetActivityRow `json:"activities"`
	User       UserData            `json:"user"`
}

// SettingsResponse is the API response for settings endpoints
type SettingsResponse struct {
	Settings []database.Setting `json:"settings"`
	User     UserData           `json:"user"`
	Timezone *string            `json:"timezone"`
}

// LoginRequest is the request body for login
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// LoginResponse is the response for successful login
type LoginResponse struct {
	Username string `json:"username"`
	IsAdmin  bool   `json:"is_admin"`
}

// ErrorResponse represents an API error
type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}