package api

import (
	"time"

	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/pkg/ptr"
	"reichard.io/antholume/pkg/utils"
	"reichard.io/antholume/search"
	"reichard.io/antholume/web/models"
)

func convertDBDocToUI(r database.GetDocumentsWithStatsRow) models.Document {
	return models.Document{
		ID:             r.ID,
		Title:          ptr.Deref(r.Title),
		Author:         ptr.Deref(r.Author),
		ISBN10:         ptr.Deref(r.Isbn10),
		ISBN13:         ptr.Deref(r.Isbn13),
		Description:    ptr.Deref(r.Description),
		Percentage:     r.Percentage,
		WPM:            r.Wpm,
		Words:          r.Words,
		TotalTimeRead:  time.Duration(r.TotalTimeSeconds) * time.Second,
		TimePerPercent: time.Duration(r.SecondsPerPercent) * time.Second,
		HasFile:        ptr.Deref(r.Filepath) != "",
	}
}

func convertMetaToUI(m metadata.MetadataInfo, errorMsg *string) *models.DocumentMetadata {
	return &models.DocumentMetadata{
		SourceID:    ptr.Deref(m.SourceID),
		ISBN10:      ptr.Deref(m.ISBN10),
		ISBN13:      ptr.Deref(m.ISBN13),
		Title:       ptr.Deref(m.Title),
		Author:      ptr.Deref(m.Author),
		Description: ptr.Deref(m.Description),
		Source:      m.Source,
		Error:       errorMsg,
	}
}

func convertDBActivityToUI(r database.GetActivityRow) models.Activity {
	return models.Activity{
		ID:         r.DocumentID,
		Author:     utils.FirstNonZero(ptr.Deref(r.Author), "N/A"),
		Title:      utils.FirstNonZero(ptr.Deref(r.Title), "N/A"),
		StartTime:  r.StartTime,
		Duration:   time.Duration(r.Duration) * time.Second,
		Percentage: r.EndPercentage,
	}
}

func convertDBProgressToUI(r database.GetProgressRow) models.Progress {
	return models.Progress{
		ID:         r.DocumentID,
		Author:     utils.FirstNonZero(ptr.Deref(r.Author), "N/A"),
		Title:      utils.FirstNonZero(ptr.Deref(r.Title), "N/A"),
		DeviceName: r.DeviceName,
		Percentage: r.Percentage,
		CreatedAt:  r.CreatedAt,
	}
}

func convertSearchToUI(r search.SearchItem) models.SearchResult {
	return models.SearchResult{
		ID:         r.ID,
		Title:      r.Title,
		Author:     r.Author,
		Series:     r.Series,
		FileType:   r.FileType,
		FileSize:   r.FileSize,
		UploadDate: r.UploadDate,
	}
}
