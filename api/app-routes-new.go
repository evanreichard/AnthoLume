package api

import (
	"cmp"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/pkg/formatters"
	"reichard.io/antholume/pkg/ptr"
	"reichard.io/antholume/pkg/sliceutils"
	"reichard.io/antholume/pkg/utils"
	"reichard.io/antholume/search"
	"reichard.io/antholume/web/components/layout"
	"reichard.io/antholume/web/components/stats"
	"reichard.io/antholume/web/models"
	"reichard.io/antholume/web/pages"
)

func (api *API) appGetHomeNew(c *gin.Context) {
	_, auth := api.getBaseTemplateVars("home", c)

	start := time.Now()
	dailyStats, err := api.db.Queries.GetDailyReadStats(c, auth.UserName)
	if err != nil {
		log.Error("GetDailyReadStats DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDailyReadStats DB Error: %v", err))
		return
	}
	log.Debug("GetDailyReadStats DB Performance: ", time.Since(start))

	start = time.Now()
	databaseInfo, err := api.db.Queries.GetDatabaseInfo(c, auth.UserName)
	if err != nil {
		log.Error("GetDatabaseInfo DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDatabaseInfo DB Error: %v", err))
		return
	}
	log.Debug("GetDatabaseInfo DB Performance: ", time.Since(start))

	start = time.Now()
	streaks, err := api.db.Queries.GetUserStreaks(c, auth.UserName)
	if err != nil {
		log.Error("GetUserStreaks DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUserStreaks DB Error: %v", err))
		return
	}
	log.Debug("GetUserStreaks DB Performance: ", time.Since(start))

	start = time.Now()
	userStatistics, err := api.db.Queries.GetUserStatistics(c)
	if err != nil {
		log.Error("GetUserStatistics DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUserStatistics DB Error: %v", err))
		return
	}
	log.Debug("GetUserStatistics DB Performance: ", time.Since(start))

	err = layout.Layout(
		pages.Home{
			Leaderboard: arrangeUserStatisticsNew(userStatistics),
			Streaks:     streaks,
			DailyStats:  dailyStats,
			RecordInfo:  &databaseInfo,
		},
		layout.LayoutOptions{
			Username:      auth.UserName,
			IsAdmin:       auth.IsAdmin,
			SearchEnabled: api.cfg.SearchEnabled,
			Version:       api.cfg.Version,
		},
	).Render(c.Writer)
	if err != nil {
		log.Error("Render Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Unknown Error: %v", err))
	}
}

func (api *API) appGetDocumentsNew(c *gin.Context) {
	_, auth := api.getBaseTemplateVars("documents", c)
	qParams := bindQueryParams(c, 9)

	var query *string
	if qParams.Search != nil && *qParams.Search != "" {
		search := "%" + *qParams.Search + "%"
		query = &search
	}

	documents, err := api.db.Queries.GetDocumentsWithStats(c, database.GetDocumentsWithStatsParams{
		UserID:  auth.UserName,
		Query:   query,
		Deleted: ptr.Of(false),
		Offset:  (*qParams.Page - 1) * *qParams.Limit,
		Limit:   *qParams.Limit,
	})
	if err != nil {
		log.Error("GetDocumentsWithStats DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentsWithStats DB Error: %v", err))
		return
	}

	length, err := api.db.Queries.GetDocumentsSize(c, query)
	if err != nil {
		log.Error("GetDocumentsSize DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentsSize DB Error: %v", err))
		return
	}

	if err = api.getDocumentsWordCount(c, documents); err != nil {
		log.Error("Unable to Get Word Counts: ", err)
	}

	totalPages := int64(math.Ceil(float64(length) / float64(*qParams.Limit)))
	nextPage := *qParams.Page + 1
	previousPage := *qParams.Page - 1

	err = layout.Layout(
		pages.Documents{
			Data:     sliceutils.Map(documents, convertDBDocToUI),
			Previous: utils.Ternary(previousPage >= 0, int(previousPage), 0),
			Next:     utils.Ternary(nextPage <= totalPages, int(nextPage), 0),
			Limit:    int(ptr.Deref(qParams.Limit)),
		},
		layout.LayoutOptions{
			Username:      auth.UserName,
			IsAdmin:       auth.IsAdmin,
			SearchEnabled: api.cfg.SearchEnabled,
			Version:       api.cfg.Version,
		},
	).Render(c.Writer)
	if err != nil {
		log.Error("Render Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Unknown Error: %v", err))
	}
}

func (api *API) appGetDocumentNew(c *gin.Context) {
	_, auth := api.getBaseTemplateVars("document", c)

	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid document")
		return
	}

	document, err := api.db.GetDocument(c, rDocID.DocumentID, auth.UserName)
	if err != nil {
		log.Error("GetDocument DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocument DB Error: %v", err))
		return
	}

	err = layout.Layout(
		pages.Document{
			Data: convertDBDocToUI(*document),
		},
		layout.LayoutOptions{
			Username:      auth.UserName,
			IsAdmin:       auth.IsAdmin,
			SearchEnabled: api.cfg.SearchEnabled,
			Version:       api.cfg.Version,
		},
	).Render(c.Writer)
	if err != nil {
		log.Error("Render Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Unknown Error: %v", err))
	}
}

func (api *API) appGetActivityNew(c *gin.Context) {
	_, auth := api.getBaseTemplateVars("activity", c)
	qParams := bindQueryParams(c, 15)

	activityFilter := database.GetActivityParams{
		UserID: auth.UserName,
		Offset: (*qParams.Page - 1) * *qParams.Limit,
		Limit:  *qParams.Limit,
	}

	if qParams.Document != nil {
		activityFilter.DocFilter = true
		activityFilter.DocumentID = *qParams.Document
	}

	activity, err := api.db.Queries.GetActivity(c, activityFilter)
	if err != nil {
		log.Error("GetActivity DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetActivity DB Error: %v", err))
		return
	}

	err = layout.Layout(
		pages.Activity{
			Data: sliceutils.Map(activity, convertDBActivityToUI),
		},
		layout.LayoutOptions{
			Username:      auth.UserName,
			IsAdmin:       auth.IsAdmin,
			SearchEnabled: api.cfg.SearchEnabled,
			Version:       api.cfg.Version,
		},
	).Render(c.Writer)
	if err != nil {
		log.Error("Render Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Unknown Error: %v", err))
	}
}

func (api *API) appGetProgressNew(c *gin.Context) {
	_, auth := api.getBaseTemplateVars("progress", c)

	qParams := bindQueryParams(c, 15)

	progressFilter := database.GetProgressParams{
		UserID: auth.UserName,
		Offset: (*qParams.Page - 1) * *qParams.Limit,
		Limit:  *qParams.Limit,
	}

	if qParams.Document != nil {
		progressFilter.DocFilter = true
		progressFilter.DocumentID = *qParams.Document
	}

	progress, err := api.db.Queries.GetProgress(c, progressFilter)
	if err != nil {
		log.Error("GetProgress DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetActivity DB Error: %v", err))
		return
	}

	err = layout.Layout(
		pages.Progress{
			Data: sliceutils.Map(progress, convertDBProgressToUI),
		},
		layout.LayoutOptions{
			Username:      auth.UserName,
			IsAdmin:       auth.IsAdmin,
			SearchEnabled: api.cfg.SearchEnabled,
			Version:       api.cfg.Version,
		},
	).Render(c.Writer)
	if err != nil {
		log.Error("Render Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Unknown Error: %v", err))
	}
}

func (api *API) appIdentifyDocumentNew(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid document")
		return
	}

	var rDocIdentify requestDocumentIdentify
	if err := c.ShouldBind(&rDocIdentify); err != nil {
		log.Error("Invalid Form Bind")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values")
		return
	}

	// Disallow Empty Strings
	if rDocIdentify.Title != nil && strings.TrimSpace(*rDocIdentify.Title) == "" {
		rDocIdentify.Title = nil
	}
	if rDocIdentify.Author != nil && strings.TrimSpace(*rDocIdentify.Author) == "" {
		rDocIdentify.Author = nil
	}
	if rDocIdentify.ISBN != nil && strings.TrimSpace(*rDocIdentify.ISBN) == "" {
		rDocIdentify.ISBN = nil
	}

	// Validate Values
	if rDocIdentify.ISBN == nil && rDocIdentify.Title == nil && rDocIdentify.Author == nil {
		log.Error("Invalid Form")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values")
		return
	}

	// Get Template Variables
	_, auth := api.getBaseTemplateVars("document", c)

	// Get Metadata
	metadataResults, err := metadata.SearchMetadata(metadata.SourceGoogleBooks, metadata.MetadataInfo{
		Title:  rDocIdentify.Title,
		Author: rDocIdentify.Author,
		ISBN10: rDocIdentify.ISBN,
		ISBN13: rDocIdentify.ISBN,
	})
	if err != nil {
		log.Error("Search Metadata Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Search Metadata Error: %v", err))
		return
	}

	var errorMsg *string
	firstResult, found := sliceutils.First(metadataResults)
	if found {
		// Store First Metadata Result
		if _, err = api.db.Queries.AddMetadata(c, database.AddMetadataParams{
			DocumentID:  rDocID.DocumentID,
			Title:       firstResult.Title,
			Author:      firstResult.Author,
			Description: firstResult.Description,
			Gbid:        firstResult.SourceID,
			Olid:        nil,
			Isbn10:      firstResult.ISBN10,
			Isbn13:      firstResult.ISBN13,
		}); err != nil {
			log.Error("AddMetadata DB Error: ", err)
		}
	} else {
		errorMsg = ptr.Of("No Metadata Found")
	}

	document, err := api.db.GetDocument(c, rDocID.DocumentID, auth.UserName)
	if err != nil {
		log.Error("GetDocument DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocument DB Error: %v", err))
		return
	}

	err = layout.Layout(
		pages.Document{
			Data:   convertDBDocToUI(*document),
			Search: convertMetaToUI(firstResult, errorMsg),
		},
		layout.LayoutOptions{
			Username:      auth.UserName,
			IsAdmin:       auth.IsAdmin,
			SearchEnabled: api.cfg.SearchEnabled,
			Version:       api.cfg.Version,
		},
	).Render(c.Writer)
	if err != nil {
		log.Error("Render Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Unknown Error: %v", err))
	}
}

// Tabs:
//   - General (Import, Backup & Restore, Version (githash?), Stats?)
//   - Users
//   - Metadata
func (api *API) appGetSearchNew(c *gin.Context) {
	_, auth := api.getBaseTemplateVars("search", c)

	var sParams searchParams
	err := c.BindQuery(&sParams)
	if err != nil {
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Invalid Form Bind: %v", err))
		return
	}

	// Only Handle Query
	var searchResults []models.SearchResult
	var searchError string
	if sParams.Query != nil && sParams.Source != nil {
		results, err := search.SearchBook(*sParams.Query, *sParams.Source)
		if err != nil {
			appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Search Error: %v", err))
			return
		}
		searchResults = sliceutils.Map(results, convertSearchToUI)
	} else if sParams.Query != nil || sParams.Source != nil {
		searchError = "Invailid Query"
	}

	err = layout.Layout(
		pages.Search{
			Results: searchResults,
			Source:  ptr.Deref(sParams.Source),
			Query:   ptr.Deref(sParams.Query),
			Error:   searchError,
		},
		layout.LayoutOptions{
			Username:      auth.UserName,
			IsAdmin:       auth.IsAdmin,
			SearchEnabled: api.cfg.SearchEnabled,
			Version:       api.cfg.Version,
		},
	).Render(c.Writer)
	if err != nil {
		log.Error("Render Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Unknown Error: %v", err))
	}
}

func sortItem[T cmp.Ordered](
	data []database.GetUserStatisticsRow,
	accessor func(s database.GetUserStatisticsRow) T,
	formatter func(s T) string,
) []stats.LeaderboardItem {
	sort.SliceStable(data, func(i, j int) bool {
		return accessor(data[i]) > accessor(data[j])
	})

	var items []stats.LeaderboardItem
	for _, s := range data {
		items = append(items, stats.LeaderboardItem{
			UserID: s.UserID,
			Value:  formatter(accessor(s)),
		})
	}
	return items
}

func arrangeUserStatisticsNew(data []database.GetUserStatisticsRow) []stats.LeaderboardData {
	wpmFormatter := func(v float64) string { return fmt.Sprintf("%.2f WPM", v) }
	return []stats.LeaderboardData{
		{
			Name:  "WPM",
			All:   sortItem(data, func(r database.GetUserStatisticsRow) float64 { return r.TotalWpm }, wpmFormatter),
			Year:  sortItem(data, func(r database.GetUserStatisticsRow) float64 { return r.YearlyWpm }, wpmFormatter),
			Month: sortItem(data, func(r database.GetUserStatisticsRow) float64 { return r.MonthlyWpm }, wpmFormatter),
			Week:  sortItem(data, func(r database.GetUserStatisticsRow) float64 { return r.WeeklyWpm }, wpmFormatter),
		},
		{
			Name:  "Words",
			All:   sortItem(data, func(r database.GetUserStatisticsRow) int64 { return r.TotalWordsRead }, formatters.FormatNumber),
			Year:  sortItem(data, func(r database.GetUserStatisticsRow) int64 { return r.YearlyWordsRead }, formatters.FormatNumber),
			Month: sortItem(data, func(r database.GetUserStatisticsRow) int64 { return r.MonthlyWordsRead }, formatters.FormatNumber),
			Week:  sortItem(data, func(r database.GetUserStatisticsRow) int64 { return r.WeeklyWordsRead }, formatters.FormatNumber),
		},
		{
			Name: "Duration",
			All: sortItem(data, func(r database.GetUserStatisticsRow) time.Duration {
				return time.Duration(r.TotalSeconds) * time.Second
			}, formatters.FormatDuration),
			Year: sortItem(data, func(r database.GetUserStatisticsRow) time.Duration {
				return time.Duration(r.YearlySeconds) * time.Second
			}, formatters.FormatDuration),
			Month: sortItem(data, func(r database.GetUserStatisticsRow) time.Duration {
				return time.Duration(r.MonthlySeconds) * time.Second
			}, formatters.FormatDuration),
			Week: sortItem(data, func(r database.GetUserStatisticsRow) time.Duration {
				return time.Duration(r.WeeklySeconds) * time.Second
			}, formatters.FormatDuration),
		},
	}
}
