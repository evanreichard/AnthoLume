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

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
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
	DocumentID string  `json:"document"`
	Percentage float64 `json:"percentage"`
	Progress   string  `json:"progress"`
	Device     string  `json:"device"`
	DeviceID   string  `json:"device_id"`
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
		log.Error("Invalid JSON Bind")
		apiErrorPage(c, http.StatusBadRequest, "Invalid Progress Data")
		return
	}

	// Upsert Device
	if _, err := api.db.Queries.UpsertDevice(c, database.UpsertDeviceParams{
		ID:         rPosition.DeviceID,
		UserID:     auth.UserName,
		DeviceName: rPosition.Device,
		LastSynced: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		log.Error("UpsertDevice DB Error:", err)
	}

	// Upsert Document
	if _, err := api.db.Queries.UpsertDocument(c, database.UpsertDocumentParams{
		ID: rPosition.DocumentID,
	}); err != nil {
		log.Error("UpsertDocument DB Error:", err)
	}

	// Create or Replace Progress
	progress, err := api.db.Queries.UpdateProgress(c, database.UpdateProgressParams{
		Percentage: rPosition.Percentage,
		DocumentID: rPosition.DocumentID,
		DeviceID:   rPosition.DeviceID,
		UserID:     auth.UserName,
		Progress:   rPosition.Progress,
	})
	if err != nil {
		log.Error("UpdateProgress DB Error:", err)
		apiErrorPage(c, http.StatusBadRequest, "Invalid Request")
		return
	}

	koJSON(c, http.StatusOK, gin.H{
		"document":  progress.DocumentID,
		"timestamp": progress.CreatedAt,
	})
}

func (api *API) koGetProgress(c *gin.Context) {
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("Invalid URI Bind")
		apiErrorPage(c, http.StatusBadRequest, "Invalid Request")
		return
	}

	progress, err := api.db.Queries.GetDocumentProgress(c, database.GetDocumentProgressParams{
		DocumentID: rDocID.DocumentID,
		UserID:     auth.UserName,
	})

	if err == sql.ErrNoRows {
		// Not Found
		koJSON(c, http.StatusOK, gin.H{})
		return
	} else if err != nil {
		log.Error("GetDocumentProgress DB Error:", err)
		apiErrorPage(c, http.StatusBadRequest, "Invalid Document")
		return
	}

	koJSON(c, http.StatusOK, gin.H{
		"document":   progress.DocumentID,
		"percentage": progress.Percentage,
		"progress":   progress.Progress,
		"device":     progress.DeviceName,
		"device_id":  progress.DeviceID,
	})
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

	// Do Transaction
	tx, err := api.db.DB.Begin()
	if err != nil {
		log.Error("Transaction Begin DB Error:", err)
		apiErrorPage(c, http.StatusBadRequest, "Unknown Error")
		return
	}

	// Derive Unique Documents
	allDocumentsMap := make(map[string]bool)
	for _, item := range rActivity.Activity {
		allDocumentsMap[item.DocumentID] = true
	}
	allDocuments := getKeys(allDocumentsMap)

	// Defer & Start Transaction
	defer func() {
		if err := tx.Rollback(); err != nil {
			log.Error("DB Rollback Error:", err)
		}
	}()
	qtx := api.db.Queries.WithTx(tx)

	// Upsert Documents
	for _, doc := range allDocuments {
		if _, err := qtx.UpsertDocument(c, database.UpsertDocumentParams{
			ID: doc,
		}); err != nil {
			log.Error("UpsertDocument DB Error:", err)
			apiErrorPage(c, http.StatusBadRequest, "Invalid Document")
			return
		}
	}

	// Upsert Device
	if _, err = qtx.UpsertDevice(c, database.UpsertDeviceParams{
		ID:         rActivity.DeviceID,
		UserID:     auth.UserName,
		DeviceName: rActivity.Device,
		LastSynced: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		log.Error("UpsertDevice DB Error:", err)
		apiErrorPage(c, http.StatusBadRequest, "Invalid Device")
		return
	}

	// Add All Activity
	for _, item := range rActivity.Activity {
		if _, err := qtx.AddActivity(c, database.AddActivityParams{
			UserID:          auth.UserName,
			DocumentID:      item.DocumentID,
			DeviceID:        rActivity.DeviceID,
			StartTime:       time.Unix(int64(item.StartTime), 0).UTC().Format(time.RFC3339),
			Duration:        int64(item.Duration),
			StartPercentage: float64(item.Page) / float64(item.Pages),
			EndPercentage:   float64(item.Page+1) / float64(item.Pages),
		}); err != nil {
			log.Error("AddActivity DB Error:", err)
			apiErrorPage(c, http.StatusBadRequest, "Invalid Activity")
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
	if _, err := api.db.Queries.UpsertDevice(c, database.UpsertDeviceParams{
		ID:         rCheckActivity.DeviceID,
		UserID:     auth.UserName,
		DeviceName: rCheckActivity.Device,
		LastSynced: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		log.Error("UpsertDevice DB Error", err)
		apiErrorPage(c, http.StatusBadRequest, "Invalid Device")
		return
	}

	// Get Last Device Activity
	lastActivity, err := api.db.Queries.GetLastActivity(c, database.GetLastActivityParams{
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
		_, err := qtx.UpsertDocument(c, database.UpsertDocumentParams{
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
	_, err := api.db.Queries.UpsertDevice(c, database.UpsertDeviceParams{
		ID:         rCheckDocs.DeviceID,
		UserID:     auth.UserName,
		DeviceName: rCheckDocs.Device,
		LastSynced: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		log.Error("UpsertDevice DB Error", err)
		apiErrorPage(c, http.StatusBadRequest, "Invalid Device")
		return
	}

	// Get Missing Documents
	missingDocs, err := api.db.Queries.GetMissingDocuments(c, rCheckDocs.Have)
	if err != nil {
		log.Error("GetMissingDocuments DB Error", err)
		apiErrorPage(c, http.StatusBadRequest, "Invalid Request")
		return
	}

	// Get Deleted Documents
	deletedDocIDs, err := api.db.Queries.GetDeletedDocuments(c, rCheckDocs.Have)
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

	wantedDocs, err := api.db.Queries.GetWantedDocuments(c, string(jsonHaves))
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

	// Open Form File
	fileData, err := c.FormFile("file")
	if err != nil {
		log.Error("File Error:", err)
		apiErrorPage(c, http.StatusBadRequest, "File error")
		return
	}

	// Validate Document Exists in DB
	document, err := api.db.Queries.GetDocument(c, rDoc.DocumentID)
	if err != nil {
		log.Error("GetDocument DB Error:", err)
		apiErrorPage(c, http.StatusBadRequest, "Unknown Document")
		return
	}

	// Open File
	uploadedFile, err := fileData.Open()
	if err != nil {
		log.Error("Unable to open file")
		apiErrorPage(c, http.StatusBadRequest, "Unable to open file")
		return
	}

	// Check Support
	docType, err := metadata.GetDocumentTypeReader(uploadedFile)
	if err != nil {
		log.Error("Unsupported file")
		apiErrorPage(c, http.StatusBadRequest, "Unsupported file")
		return
	}

	// Derive Filename
	fileName := deriveBaseFileName(&metadata.MetadataInfo{
		Type:       *docType,
		PartialMD5: &document.ID,
		Title:      document.Title,
		Author:     document.Author,
	})

	// Generate Storage Path
	basePath := filepath.Join(api.cfg.DataPath, "documents")
	safePath := filepath.Join(basePath, fileName)

	// Save & Prevent Overwrites
	_, err = os.Stat(safePath)
	if os.IsNotExist(err) {
		err = c.SaveUploadedFile(fileData, safePath)
		if err != nil {
			log.Error("Save Failure:", err)
			apiErrorPage(c, http.StatusBadRequest, "File Error")
			return
		}
	}

	// Acquire Metadata
	metadataInfo, err := metadata.GetMetadata(safePath)
	if err != nil {
		log.Errorf("Unable to acquire metadata: %v", err)
		apiErrorPage(c, http.StatusBadRequest, "Unable to acquire metadata")
		return
	}

	// Upsert Document
	if _, err = api.db.Queries.UpsertDocument(c, database.UpsertDocumentParams{
		ID:       document.ID,
		Md5:      metadataInfo.MD5,
		Words:    metadataInfo.WordCount,
		Filepath: &fileName,
		Basepath: &basePath,
	}); err != nil {
		log.Error("UpsertDocument DB Error:", err)
		apiErrorPage(c, http.StatusBadRequest, "Document Error")
		return
	}

	koJSON(c, http.StatusOK, gin.H{
		"status": "ok",
	})
}

func (api *API) koDemoModeJSONError(c *gin.Context) {
	apiErrorPage(c, http.StatusUnauthorized, "Not Allowed in Demo Mode")
}

func apiErrorPage(c *gin.Context, errorCode int, errorMessage string) {
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
