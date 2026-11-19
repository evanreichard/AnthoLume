package api

import (
	"crypto/md5"
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"errors"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/reading"
)

type activityItem struct {
	DocumentID string `json:"document"`
	StartTime  int64  `json:"start_time"`
	Duration   int64  `json:"duration"`
	Page       int64  `json:"page"`
	Pages      int64  `json:"pages"`
}

type requestActivity struct {
	DeviceID string         `json:"device_id"`
	Device   string         `json:"device"`
	Activity []activityItem `json:"activity"`
}

type requestCheckActivitySync struct {
	DeviceID string `json:"device_id"`
	Device   string `json:"device"`
}

type requestDocument struct {
	Documents []database.Document `json:"documents"`
}

type requestPosition struct {
	DocumentID string   `json:"document"`
	Percentage *float64 `json:"percentage"`
	Progress   *string  `json:"progress"`
	Device     *string  `json:"device"`
	DeviceID   *string  `json:"device_id"`
}

type requestUser struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type requestCheckDocumentSync struct {
	DeviceID string   `json:"device_id"`
	Device   string   `json:"device"`
	Have     []string `json:"have"`
}

type responseCheckDocumentSync struct {
	WantFiles    []string            `json:"want_files"`
	WantMetadata []string            `json:"want_metadata"`
	Give         []database.Document `json:"give"`
	Delete       []string            `json:"deleted"`
}

type requestDocumentID struct {
	DocumentID string `uri:"document" binding:"required"`
}

func (api *API) koAuthorizeUser(c *gin.Context) {
	koJSON(c, 200, gin.H{
		"authorized": "OK",
	})
}

func (api *API) koSetProgress(c *gin.Context) {
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	var rPosition requestPosition
	if err := c.ShouldBindJSON(&rPosition); err != nil {
		koSyncError(c, 2003)
		return
	}
	if rPosition.DocumentID == "" {
		koSyncError(c, 2004)
		return
	}
	if rPosition.Percentage == nil || rPosition.Progress == nil || rPosition.Device == nil {
		koSyncError(c, 2003)
		return
	}

	timestamp, err := api.reading.KOProgress(c.Request.Context(), auth.UserName, rPosition.DocumentID, rPosition.DeviceID, *rPosition.Device, *rPosition.Progress, *rPosition.Percentage)
	if err != nil {
		koSyncOperationError(c, err)
		return
	}

	acceptedAt, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		koSyncOperationError(c, err)
		return
	}
	koJSON(c, http.StatusOK, gin.H{
		"document":  rPosition.DocumentID,
		"timestamp": acceptedAt.Unix(),
	})
}

func (api *API) koGetProgress(c *gin.Context) {
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		koSyncError(c, 2004)
		return
	}

	progress, err := api.reading.State(c.Request.Context(), auth.UserName, rDocID.DocumentID)
	var failure *reading.Failure
	if errors.As(err, &failure) && failure.Status == 404 || err == nil && progress.Position == nil {
		// Not Found
		koJSON(c, http.StatusOK, gin.H{})
		return
	} else if err != nil {
		koSyncOperationError(c, err)
		return
	}

	if progress.UpdatedAt == nil {
		koSyncOperationError(c, errors.New("reading head has no update timestamp"))
		return
	}
	updatedAt, err := time.Parse(time.RFC3339, *progress.UpdatedAt)
	if err != nil {
		koSyncOperationError(c, err)
		return
	}
	response := gin.H{"document": progress.DocumentID, "percentage": progress.Fraction, "progress": progress.Position, "device": progress.DeviceName, "timestamp": updatedAt.Unix()}
	if progress.ExternalDeviceID != nil {
		response["device_id"] = *progress.ExternalDeviceID
	}
	koJSON(c, http.StatusOK, response)
}

func (api *API) koAddActivities(c *gin.Context) {
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	var rActivity requestActivity
	if err := c.ShouldBindJSON(&rActivity); err != nil {
		log.Error("Invalid JSON Bind")
		apiErrorPage(c, http.StatusBadRequest, "Invalid Activity")
		return
	}

	events := make([]reading.Activity, 0, len(rActivity.Activity))
	for _, item := range rActivity.Activity {
		if item.Pages <= 0 || item.Page < 0 || item.Page > item.Pages || item.Duration < 0 || item.Duration > 86400 {
			apiErrorPage(c, 400, "Invalid Activity")
			return
		}
		// Final Page - SyncNinja can report page == pages; credit that time to the last interval.
		page := min(item.Page, item.Pages-1)
		events = append(events, reading.Activity{DocumentID: item.DocumentID, DeviceID: rActivity.DeviceID, StartTime: time.Unix(item.StartTime, 0).UTC(), Duration: int(item.Duration), StartFraction: float64(page) / float64(item.Pages), EndFraction: float64(page+1) / float64(item.Pages)})
	}
	if err := api.reading.KOActivity(c.Request.Context(), auth.UserName, rActivity.DeviceID, rActivity.Device, events); err != nil {
		koOperationError(c, err)
		return
	}

	koJSON(c, http.StatusOK, gin.H{
		"added": len(rActivity.Activity),
	})
}

func (api *API) koCheckActivitySync(c *gin.Context) {
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	var rCheckActivity requestCheckActivitySync
	if err := c.ShouldBindJSON(&rCheckActivity); err != nil {
		log.Error("Invalid JSON Bind")
		apiErrorPage(c, http.StatusBadRequest, "Invalid Request")
		return
	}

	// Upsert Device
	if err := api.reading.RegisterDevice(c.Request.Context(), auth.UserName, rCheckActivity.DeviceID, rCheckActivity.Device); err != nil {
		koOperationError(c, err)
		return
	}

	// Get Last Device Activity
	lastActivity, err := api.db.Queries.GetLastActivity(c.Request.Context(), database.GetLastActivityParams{
		UserID:   auth.UserName,
		DeviceID: rCheckActivity.DeviceID,
	})
	if err == sql.ErrNoRows {
		lastActivity = time.UnixMilli(0).Format(time.RFC3339)
	} else if err != nil {
		log.Error("GetLastActivity DB Error:", err)
		apiErrorPage(c, http.StatusBadRequest, "Unknown Error")
		return
	}

	// Parse Time
	parsedTime, err := time.Parse(time.RFC3339, lastActivity)
	if err != nil {
		log.Error("Time Parse Error:", err)
		apiErrorPage(c, http.StatusBadRequest, "Unknown Error")
		return
	}

	koJSON(c, http.StatusOK, gin.H{
		"last_sync": parsedTime.Unix(),
	})
}

func (api *API) koAddDocuments(c *gin.Context) {
	var rNewDocs requestDocument
	if err := c.ShouldBindJSON(&rNewDocs); err != nil {
		log.Error("Invalid JSON Bind")
		apiErrorPage(c, http.StatusBadRequest, "Invalid Document(s)")
		return
	}

	// Do Transaction
	tx, err := api.db.DB.Begin()
	if err != nil {
		log.Error("Transaction Begin DB Error:", err)
		apiErrorPage(c, http.StatusBadRequest, "Unknown Error")
		return
	}

	// Defer & Start Transaction
	defer func() {
		if err := tx.Rollback(); err != nil {
			log.Error("DB Rollback Error:", err)
		}
	}()
	qtx := api.db.Queries.WithTx(tx)

	// Upsert Documents
	for _, doc := range rNewDocs.Documents {
		_, err := qtx.UpsertDocument(c.Request.Context(), database.UpsertDocumentParams{
			ID:          doc.ID,
			Title:       api.sanitizeInput(doc.Title),
			Author:      api.sanitizeInput(doc.Author),
			Series:      api.sanitizeInput(doc.Series),
			SeriesIndex: doc.SeriesIndex,
			Lang:        api.sanitizeInput(doc.Lang),
			Description: api.sanitizeInput(doc.Description),
		})
		if err != nil {
			log.Error("UpsertDocument DB Error:", err)
			apiErrorPage(c, http.StatusBadRequest, "Invalid Document")
			return
		}
	}

	// Commit Transaction
	if err := tx.Commit(); err != nil {
		log.Error("Transaction Commit DB Error:", err)
		apiErrorPage(c, http.StatusBadRequest, "Unknown Error")
		return
	}

	koJSON(c, http.StatusOK, gin.H{
		"changed": len(rNewDocs.Documents),
	})
}

func (api *API) koCheckDocumentsSync(c *gin.Context) {
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	var rCheckDocs requestCheckDocumentSync
	if err := c.ShouldBindJSON(&rCheckDocs); err != nil {
		log.Error("Invalid JSON Bind")
		apiErrorPage(c, http.StatusBadRequest, "Invalid Request")
		return
	}

	// Upsert Device
	err := api.reading.RegisterDevice(c.Request.Context(), auth.UserName, rCheckDocs.DeviceID, rCheckDocs.Device)
	if err != nil {
		koOperationError(c, err)
		return
	}

	// Get Missing Documents
	missingDocs, err := api.db.Queries.GetMissingDocuments(c.Request.Context(), rCheckDocs.Have)
	if err != nil {
		log.Error("GetMissingDocuments DB Error", err)
		apiErrorPage(c, http.StatusBadRequest, "Invalid Request")
		return
	}

	// Get Deleted Documents
	deletedDocIDs, err := api.db.Queries.GetDeletedDocuments(c.Request.Context(), rCheckDocs.Have)
	if err != nil {
		log.Error("GetDeletedDocuments DB Error", err)
		apiErrorPage(c, http.StatusBadRequest, "Invalid Request")
		return
	}

	// Get Wanted Documents
	jsonHaves, err := json.Marshal(rCheckDocs.Have)
	if err != nil {
		log.Error("JSON Marshal Error", err)
		apiErrorPage(c, http.StatusBadRequest, "Invalid Request")
		return
	}

	wantedDocs, err := api.db.Queries.GetWantedDocuments(c.Request.Context(), string(jsonHaves))
	if err != nil {
		log.Error("GetWantedDocuments DB Error", err)
		apiErrorPage(c, http.StatusBadRequest, "Invalid Request")
		return
	}

	// Split Metadata & File Wants
	var wantedMetadataDocIDs []string
	var wantedFilesDocIDs []string
	for _, v := range wantedDocs {
		if v.WantMetadata {
			wantedMetadataDocIDs = append(wantedMetadataDocIDs, v.ID)
		}
		if v.WantFile {
			wantedFilesDocIDs = append(wantedFilesDocIDs, v.ID)
		}
	}

	rCheckDocSync := responseCheckDocumentSync{
		Delete:       []string{},
		WantFiles:    []string{},
		WantMetadata: []string{},
		Give:         []database.Document{},
	}

	// Ensure Empty Array
	if wantedMetadataDocIDs != nil {
		rCheckDocSync.WantMetadata = wantedMetadataDocIDs
	}
	if wantedFilesDocIDs != nil {
		rCheckDocSync.WantFiles = wantedFilesDocIDs
	}
	if missingDocs != nil {
		rCheckDocSync.Give = missingDocs
	}
	if deletedDocIDs != nil {
		rCheckDocSync.Delete = deletedDocIDs
	}

	koJSON(c, http.StatusOK, rCheckDocSync)
}

func (api *API) koUploadExistingDocument(c *gin.Context) {
	var rDoc requestDocumentID
	if err := c.ShouldBindUri(&rDoc); err != nil {
		log.Error("Invalid URI Bind")
		apiErrorPage(c, http.StatusBadRequest, "Invalid Request")
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, metadata.MaxDocumentSize+(1<<20))
	fileData, err := c.FormFile("file")
	if err != nil || fileData.Size > metadata.MaxDocumentSize {
		apiErrorPage(c, http.StatusBadRequest, "File error")
		return
	}
	uploadedFile, err := fileData.Open()
	if err != nil {
		apiErrorPage(c, http.StatusBadRequest, "Unable to open file")
		return
	}
	defer uploadedFile.Close()

	if !api.libraryWrite.TryLock() {
		apiErrorPage(c, http.StatusConflict, "Library is busy")
		return
	}
	defer api.libraryWrite.Unlock()

	ctx := c.Request.Context()
	document, err := api.db.Queries.GetDocument(ctx, rDoc.DocumentID)
	if err != nil || document.Deleted {
		apiErrorPage(c, http.StatusBadRequest, "Unknown Document")
		return
	}
	root, err := api.storageRoot(ctx, libraryRoot)
	if err != nil {
		apiErrorPage(c, http.StatusInternalServerError, "File error")
		return
	}
	file, err := os.CreateTemp(root.Path, "upload-*.epub")
	if err != nil {
		apiErrorPage(c, http.StatusBadRequest, "File error")
		return
	}
	committed := false
	defer func() {
		file.Close()
		if !committed {
			os.Remove(file.Name())
		}
	}()
	n, err := io.Copy(file, io.LimitReader(contextReader{ctx, uploadedFile}, metadata.MaxDocumentSize+1))
	if err != nil || n != fileData.Size {
		apiErrorPage(c, http.StatusBadRequest, "File error")
		return
	}
	info, err := metadata.GetOpenedMetadata(file)
	if err != nil {
		apiErrorPage(c, http.StatusBadRequest, "Unable to acquire metadata")
		return
	}
	if *info.PartialMD5 != document.ID || document.Md5 != nil && *document.Md5 != *info.MD5 {
		apiErrorPage(c, http.StatusBadRequest, "Document Error")
		return
	}
	if document.Filepath != nil {
		existing, err := api.openDocument(ctx, document)
		if err != nil || document.Md5 == nil {
			if existing != nil {
				existing.Close()
			}
			apiErrorPage(c, http.StatusBadRequest, "Document Error")
			return
		}
		existing.Close()
	} else {
		if err := file.Sync(); err != nil {
			apiErrorPage(c, http.StatusBadRequest, "File error")
			return
		}
		if err := file.Close(); err != nil {
			apiErrorPage(c, http.StatusBadRequest, "File error")
			return
		}
		if err := syncAdminDirectory(root.Path); err != nil {
			apiErrorPage(c, http.StatusBadRequest, "File error")
			return
		}
		committed, err = api.attachCatalogFile(ctx, root.Id, filepath.Base(file.Name()), info)
		if err != nil || !committed {
			apiErrorPage(c, http.StatusBadRequest, "Document Error")
			return
		}
	}

	koJSON(c, http.StatusOK, gin.H{"status": "ok"})
}

func (api *API) koDemoModeJSONError(c *gin.Context) {
	apiErrorPage(c, http.StatusUnauthorized, "Not Allowed in Demo Mode")
}

func apiErrorPage(c *gin.Context, errorCode int, errorMessage string) {
	setRetryAfter(c.Writer, errorCode)
	c.AbortWithStatusJSON(errorCode, gin.H{"error": errorMessage})
}

func (api *API) sanitizeInput(val any) *string {
	switch v := val.(type) {
	case *string:
		if v != nil {
			newString := html.UnescapeString(htmlPolicy.Sanitize(string(*v)))
			return &newString
		}
	case string:
		if v != "" {
			newString := html.UnescapeString(htmlPolicy.Sanitize(string(v)))
			return &newString
		}
	}
	return nil
}

func getKeys[M ~map[K]V, K comparable, V any](m M) []K {
	r := make([]K, 0, len(m))
	for k := range m {
		r = append(r, k)
	}
	return r
}

func getFileMD5(filePath string) (*string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}

	defer file.Close()

	hash := md5.New()
	_, err = io.Copy(hash, file)
	if err != nil {
		return nil, err
	}

	fileHash := fmt.Sprintf("%x", hash.Sum(nil))

	return &fileHash, nil
}

// koJSON forces koJSON Content-Type to only return `application/json`. This is addressing
// the following issue: https://github.com/koreader/koreader/issues/13629
func koJSON(c *gin.Context, code int, obj any) {
	c.Header("Content-Type", "application/json")
	c.JSON(code, obj)
}
