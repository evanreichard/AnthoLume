package api

import (
	"cmp"
	"crypto/md5"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	argon2 "github.com/alexedwards/argon2id"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/pkg/formatters"
	"reichard.io/antholume/pkg/ptr"
	"reichard.io/antholume/pkg/sliceutils"
	"reichard.io/antholume/pkg/utils"
	"reichard.io/antholume/search"
	"reichard.io/antholume/web/components/stats"
	"reichard.io/antholume/web/models"
	"reichard.io/antholume/web/pages"
)

func (api *API) appGetHome(c *gin.Context) {
	_, auth := api.getBaseTemplateVars("home", c)

	start := time.Now()
	dailyStats, err := api.db.Queries.GetDailyReadStats(c, auth.UserName)
	if err != nil {
		log.WithError(err).Error("failed to get daily read stats")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get daily read stats: %s", err))
		return
	}
	log.Debug("GetDailyReadStats DB Performance: ", time.Since(start))

	start = time.Now()
	databaseInfo, err := api.db.Queries.GetDatabaseInfo(c, auth.UserName)
	if err != nil {
		log.WithError(err).Error("failed to get database info")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get database info: %s", err))
		return
	}
	log.Debug("GetDatabaseInfo DB Performance: ", time.Since(start))

	start = time.Now()
	streaks, err := api.db.Queries.GetUserStreaks(c, auth.UserName)
	if err != nil {
		log.WithError(err).Error("failed to get user streaks")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get user streaks: %s", err))
		return
	}
	log.Debug("GetUserStreaks DB Performance: ", time.Since(start))

	start = time.Now()
	userStatistics, err := api.db.Queries.GetUserStatistics(c)
	if err != nil {
		log.WithError(err).Error("failed to get user statistics")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get user statistics: %s", err))
		return
	}
	log.Debug("GetUserStatistics DB Performance: ", time.Since(start))

	api.renderPage(c, &pages.Home{
		Leaderboard: arrangeUserStatistic(userStatistics),
		Streaks:     streaks,
		DailyStats:  dailyStats,
		RecordInfo:  &databaseInfo,
	})
}

func (api *API) appGetDocuments(c *gin.Context) {
	qParams, err := bindQueryParams(c, 9)
	if err != nil {
		log.WithError(err).Error("failed to bind query params")
		appErrorPage(c, http.StatusBadRequest, fmt.Sprintf("failed to bind query params: %s", err))
		return
	}

	var query *string
	if qParams.Search != nil && *qParams.Search != "" {
		search := "%" + *qParams.Search + "%"
		query = &search
	}

	_, auth := api.getBaseTemplateVars("documents", c)
	documents, err := api.db.Queries.GetDocumentsWithStats(c, database.GetDocumentsWithStatsParams{
		UserID:  auth.UserName,
		Query:   query,
		Deleted: ptr.Of(false),
		Offset:  (*qParams.Page - 1) * *qParams.Limit,
		Limit:   *qParams.Limit,
	})
	if err != nil {
		log.WithError(err).Error("failed to get documents with stats")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get documents with stats: %s", err))
		return
	}

	length, err := api.db.Queries.GetDocumentsSize(c, query)
	if err != nil {
		log.WithError(err).Error("failed to get document sizes")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get document sizes: %s", err))
		return
	}

	if err = api.getDocumentsWordCount(c, documents); err != nil {
		log.WithError(err).Error("failed to get word counts")
	}

	totalPages := int64(math.Ceil(float64(length) / float64(*qParams.Limit)))
	nextPage := *qParams.Page + 1
	previousPage := *qParams.Page - 1

	api.renderPage(c, pages.Documents{
		Data:     sliceutils.Map(documents, convertDBDocToUI),
		Previous: utils.Ternary(previousPage >= 0, int(previousPage), 0),
		Next:     utils.Ternary(nextPage <= totalPages, int(nextPage), 0),
		Limit:    int(ptr.Deref(qParams.Limit)),
	})
}

func (api *API) appGetDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.WithError(err).Error("failed to bind URI")
		appErrorPage(c, http.StatusNotFound, "Invalid document")
		return
	}

	_, auth := api.getBaseTemplateVars("document", c)
	document, err := api.db.GetDocument(c, rDocID.DocumentID, auth.UserName)
	if err != nil {
		log.WithError(err).Error("failed to get document")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get document: %s", err))
		return
	}

	api.renderPage(c, &pages.Document{Data: convertDBDocToUI(*document)})
}

func (api *API) appGetActivity(c *gin.Context) {
	qParams, err := bindQueryParams(c, 15)
	if err != nil {
		log.WithError(err).Error("failed to bind query params")
		appErrorPage(c, http.StatusBadRequest, fmt.Sprintf("failed to bind query params: %s", err))
		return
	}

	_, auth := api.getBaseTemplateVars("activity", c)
	activity, err := api.db.Queries.GetActivity(c, database.GetActivityParams{
		UserID:     auth.UserName,
		Offset:     (*qParams.Page - 1) * *qParams.Limit,
		Limit:      *qParams.Limit,
		DocFilter:  qParams.Document != nil,
		DocumentID: ptr.Deref(qParams.Document),
	})
	if err != nil {
		log.WithError(err).Error("failed to get activity")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get activity: %s", err))
		return
	}

	api.renderPage(c, &pages.Activity{Data: sliceutils.Map(activity, convertDBActivityToUI)})
}

func (api *API) appGetProgress(c *gin.Context) {
	qParams, err := bindQueryParams(c, 15)
	if err != nil {
		log.WithError(err).Error("failed to bind query params")
		appErrorPage(c, http.StatusBadRequest, fmt.Sprintf("failed to bind query params: %s", err))
		return
	}

	_, auth := api.getBaseTemplateVars("progress", c)
	progress, err := api.db.Queries.GetProgress(c, database.GetProgressParams{
		UserID:     auth.UserName,
		Offset:     (*qParams.Page - 1) * *qParams.Limit,
		Limit:      *qParams.Limit,
		DocFilter:  qParams.Document != nil,
		DocumentID: ptr.Deref(qParams.Document),
	})
	if err != nil {
		log.WithError(err).Error("failed to get progress")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get progress: %s", err))
		return
	}

	api.renderPage(c, &pages.Progress{Data: sliceutils.Map(progress, convertDBProgressToUI)})
}

func (api *API) appIdentifyDocumentNew(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.WithError(err).Error("failed to bind URI")
		appErrorPage(c, http.StatusNotFound, "Invalid document")
		return
	}

	var rDocIdentify requestDocumentIdentify
	if err := c.ShouldBind(&rDocIdentify); err != nil {
		log.WithError(err).Error("failed to bind form")
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
		log.Error("invalid or missing form values")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values")
		return
	}

	// Get Metadata
	var searchResult *models.DocumentMetadata
	var allNotifications []*models.Notification
	metadataResults, err := metadata.SearchMetadata(metadata.SourceGoogleBooks, metadata.MetadataInfo{
		Title:  rDocIdentify.Title,
		Author: rDocIdentify.Author,
		ISBN10: rDocIdentify.ISBN,
		ISBN13: rDocIdentify.ISBN,
	})
	if err != nil {
		log.WithError(err).Error("failed to search metadata")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to search metadata: %s", err))
		return
	} else if firstResult, found := sliceutils.First(metadataResults); found {
		searchResult = convertMetaToUI(firstResult)

		// Store First Metadata Result
		if _, err = api.db.Queries.AddMetadata(c, database.AddMetadataParams{
			DocumentID:  rDocID.DocumentID,
			Title:       firstResult.Title,
			Author:      firstResult.Author,
			Description: firstResult.Description,
			Gbid:        firstResult.SourceID,
			Isbn10:      firstResult.ISBN10,
			Isbn13:      firstResult.ISBN13,
		}); err != nil {
			log.WithError(err).Error("failed to add metadata")
		}
	} else {
		allNotifications = append(allNotifications, &models.Notification{
			Type:    models.NotificationTypeError,
			Content: "No Metadata Found",
		})
	}

	// Get Auth
	_, auth := api.getBaseTemplateVars("document", c)
	document, err := api.db.GetDocument(c, rDocID.DocumentID, auth.UserName)
	if err != nil {
		log.WithError(err).Error("failed to get document")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get document: %s", err))
		return
	}

	api.renderPage(c, &pages.Document{
		Data:   convertDBDocToUI(*document),
		Search: searchResult,
	}, allNotifications...)
}

// Tabs:
//   - General (Import, Backup & Restore, Version (githash?), Stats?)
//   - Users
//   - Metadata
func (api *API) appGetSearch(c *gin.Context) {
	var sParams searchParams
	if err := c.BindQuery(&sParams); err != nil {
		log.WithError(err).Error("failed to bind form")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values")
		return
	}

	// Only Handle Query
	var searchResults []models.SearchResult
	var searchError string
	if sParams.Query != nil && sParams.Source != nil {
		results, err := search.SearchBook(*sParams.Query, *sParams.Source)
		if err != nil {
			log.WithError(err).Error("failed to search book")
			appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Search Error: %v", err))
			return
		}
		searchResults = sliceutils.Map(results, convertSearchToUI)
	} else if sParams.Query != nil || sParams.Source != nil {
		searchError = "Invailid Query"
	}

	api.renderPage(c, &pages.Search{
		Results: searchResults,
		Source:  ptr.Deref(sParams.Source),
		Query:   ptr.Deref(sParams.Query),
		Error:   searchError,
	})
}

func (api *API) appGetSettings(c *gin.Context) {
	_, auth := api.getBaseTemplateVars("settings", c)

	user, err := api.db.Queries.GetUser(c, auth.UserName)
	if err != nil {
		log.WithError(err).Error("failed to get user")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get user: %s", err))
		return
	}

	devices, err := api.db.Queries.GetDevices(c, auth.UserName)
	if err != nil {
		log.WithError(err).Error("failed to get devices")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get devices: %s", err))
		return
	}

	api.renderPage(c, &pages.Settings{
		Timezone: ptr.Deref(user.Timezone),
		Devices:  sliceutils.Map(devices, convertDBDeviceToUI),
	})
}

func (api *API) appEditSettings(c *gin.Context) {
	var rUserSettings requestSettingsEdit
	if err := c.ShouldBind(&rUserSettings); err != nil {
		log.WithError(err).Error("failed to bind form")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values")
		return
	}

	// Validate Something Exists
	if rUserSettings.Password == nil && rUserSettings.NewPassword == nil && rUserSettings.Timezone == nil {
		log.Error("invalid or missing form values")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values")
		return
	}

	_, auth := api.getBaseTemplateVars("settings", c)

	newUserSettings := database.UpdateUserParams{
		UserID: auth.UserName,
		Admin:  auth.IsAdmin,
	}

	// Set New Password
	var allNotifications []*models.Notification
	if rUserSettings.Password != nil && rUserSettings.NewPassword != nil {
		password := fmt.Sprintf("%x", md5.Sum([]byte(*rUserSettings.Password)))
		if _, err := api.authorizeCredentials(c, auth.UserName, password); err != nil {
			allNotifications = append(allNotifications, &models.Notification{
				Type:    models.NotificationTypeError,
				Content: "Invalid Password",
			})
		} else {
			password := fmt.Sprintf("%x", md5.Sum([]byte(*rUserSettings.NewPassword)))
			hashedPassword, err := argon2.CreateHash(password, argon2.DefaultParams)
			if err != nil {
				allNotifications = append(allNotifications, &models.Notification{
					Type:    models.NotificationTypeError,
					Content: "Unknown Error",
				})
			} else {
				allNotifications = append(allNotifications, &models.Notification{
					Type:    models.NotificationTypeSuccess,
					Content: "Password Updated",
				})
				newUserSettings.Password = &hashedPassword
			}
		}
	}

	// Set Time Offset
	if rUserSettings.Timezone != nil {
		allNotifications = append(allNotifications, &models.Notification{
			Type:    models.NotificationTypeSuccess,
			Content: "Time Offset Updated",
		})
		newUserSettings.Timezone = rUserSettings.Timezone
	}

	// Update User
	_, err := api.db.Queries.UpdateUser(c, newUserSettings)
	if err != nil {
		log.WithError(err).Error("failed to update user")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to update user: %s", err))
		return
	}

	// Get User
	user, err := api.db.Queries.GetUser(c, auth.UserName)
	if err != nil {
		log.WithError(err).Error("failed to get user")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get user: %s", err))
		return
	}

	// Get Devices
	devices, err := api.db.Queries.GetDevices(c, auth.UserName)
	if err != nil {
		log.WithError(err).Error("failed to get devices")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to get devices: %s", err))
		return
	}

	api.renderPage(c, &pages.Settings{
		Devices:  sliceutils.Map(devices, convertDBDeviceToUI),
		Timezone: ptr.Deref(user.Timezone),
	}, allNotifications...)
}

func (api *API) renderPage(c *gin.Context, page pages.Page, notifications ...*models.Notification) {
	// Get Authentication Data
	auth, err := getAuthData(c)
	if err != nil {
		log.WithError(err).Error("failed to acquire auth data")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to acquire auth data: %s", err))
		return
	}

	// Generate Page
	pageNode, err := page.Generate(models.PageContext{
		UserInfo: &models.UserInfo{
			Username: auth.UserName,
			IsAdmin:  auth.IsAdmin,
		},
		ServerInfo: &models.ServerInfo{
			RegistrationEnabled: api.cfg.RegistrationEnabled,
			SearchEnabled:       api.cfg.SearchEnabled,
			Version:             api.cfg.Version,
		},
		Notifications: notifications,
	})
	if err != nil {
		log.WithError(err).Error("failed to generate page")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to generate page: %s", err))
		return
	}

	// Render Page
	err = pageNode.Render(c.Writer)
	if err != nil {
		log.WithError(err).Error("failed to render page")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("failed to render page: %s", err))
		return
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

func arrangeUserStatistic(data []database.GetUserStatisticsRow) []stats.LeaderboardData {
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
