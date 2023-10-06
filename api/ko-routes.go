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
	"strings"
	"time"

	argon2 "github.com/alexedwards/argon2id"
	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"golang.org/x/exp/slices"
	"reichard.io/bbank/database"
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

func (api *API) authorizeUser(c *gin.Context) {
	c.JSON(200, gin.H{
		"authorized": "OK",
	})
}

func (api *API) createUser(c *gin.Context) {
	if !api.Config.RegistrationEnabled {
		c.AbortWithStatus(http.StatusConflict)
		return
	}

	var rUser requestUser
	if err := c.ShouldBindJSON(&rUser); err != nil {
		log.Error("[createUser] Invalid JSON Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid User Data"})
		return
	}

	if rUser.Username == "" || rUser.Password == "" {
		log.Error("[createUser] Invalid User - Empty Username or Password")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid User Data"})
		return
	}

	hashedPassword, err := argon2.CreateHash(rUser.Password, argon2.DefaultParams)
	if err != nil {
		log.Error("[createUser] Argon2 Hash Failure:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Error"})
		return
	}

	rows, err := api.DB.Queries.CreateUser(api.DB.Ctx, database.CreateUserParams{
		ID:   rUser.Username,
		Pass: &hashedPassword,
	})
	if err != nil {
		log.Error("[createUser] CreateUser DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid User Data"})
		return
	}

	// User Exists
	if rows == 0 {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "User Already Exists"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"username": rUser.Username,
	})
}

func (api *API) setProgress(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rPosition requestPosition
	if err := c.ShouldBindJSON(&rPosition); err != nil {
		log.Error("[setProgress] Invalid JSON Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Progress Data"})
		return
	}

	// Upsert Device
	if _, err := api.DB.Queries.UpsertDevice(api.DB.Ctx, database.UpsertDeviceParams{
		ID:         rPosition.DeviceID,
		UserID:     rUser.(string),
		DeviceName: rPosition.Device,
	}); err != nil {
		log.Error("[setProgress] UpsertDevice DB Error:", err)
	}

	// Upsert Document
	if _, err := api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
		ID: rPosition.DocumentID,
	}); err != nil {
		log.Error("[setProgress] UpsertDocument DB Error:", err)
	}

	// Create or Replace Progress
	progress, err := api.DB.Queries.UpdateProgress(api.DB.Ctx, database.UpdateProgressParams{
		Percentage: rPosition.Percentage,
		DocumentID: rPosition.DocumentID,
		DeviceID:   rPosition.DeviceID,
		UserID:     rUser.(string),
		Progress:   rPosition.Progress,
	})
	if err != nil {
		log.Error("[setProgress] UpdateProgress DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"document":  progress.DocumentID,
		"timestamp": progress.CreatedAt,
	})
}

func (api *API) getProgress(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("[getProgress] Invalid URI Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	progress, err := api.DB.Queries.GetProgress(api.DB.Ctx, database.GetProgressParams{
		DocumentID: rDocID.DocumentID,
		UserID:     rUser.(string),
	})

	if err != nil {
		log.Error("[getProgress] GetProgress DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Document"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"document":   progress.DocumentID,
		"percentage": progress.Percentage,
		"progress":   progress.Progress,
		"device":     progress.DeviceName,
		"device_id":  progress.DeviceID,
	})
}

func (api *API) addActivities(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rActivity requestActivity
	if err := c.ShouldBindJSON(&rActivity); err != nil {
		log.Error("[addActivity] Invalid JSON Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Activity"})
		return
	}

	// Do Transaction
	tx, err := api.DB.DB.Begin()
	if err != nil {
		log.Error("[addActivities] Transaction Begin DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Error"})
		return
	}

	// Derive Unique Documents
	allDocumentsMap := make(map[string]bool)
	for _, item := range rActivity.Activity {
		allDocumentsMap[item.DocumentID] = true
	}
	allDocuments := getKeys(allDocumentsMap)

	// Defer & Start Transaction
	defer tx.Rollback()
	qtx := api.DB.Queries.WithTx(tx)

	// Upsert Documents
	for _, doc := range allDocuments {
		if _, err := qtx.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
			ID: doc,
		}); err != nil {
			log.Error("[addActivities] UpsertDocument DB Error:", err)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Document"})
			return
		}
	}

	// Upsert Device
	if _, err = qtx.UpsertDevice(api.DB.Ctx, database.UpsertDeviceParams{
		ID:         rActivity.DeviceID,
		UserID:     rUser.(string),
		DeviceName: rActivity.Device,
	}); err != nil {
		log.Error("[addActivities] UpsertDevice DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Device"})
		return
	}

	// Add All Activity
	for _, item := range rActivity.Activity {
		if _, err := qtx.AddActivity(api.DB.Ctx, database.AddActivityParams{
			UserID:     rUser.(string),
			DocumentID: item.DocumentID,
			DeviceID:   rActivity.DeviceID,
			StartTime:  time.Unix(int64(item.StartTime), 0).UTC().Format(time.RFC3339),
			Duration:   int64(item.Duration),
			Page:       int64(item.Page),
			Pages:      int64(item.Pages),
		}); err != nil {
			log.Error("[addActivities] AddActivity DB Error:", err)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Activity"})
			return
		}
	}

	// Commit Transaction
	if err := tx.Commit(); err != nil {
		log.Error("[addActivities] Transaction Commit DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Error"})
		return
	}

	// Update Temp Tables
	go func() {
		log.Info("[addActivities] Caching Temp Tables")
		if err := api.DB.CacheTempTables(); err != nil {
			log.Warn("[addActivities] CacheTempTables Failure: ", err)
		}
	}()

	c.JSON(http.StatusOK, gin.H{
		"added": len(rActivity.Activity),
	})
}

func (api *API) checkActivitySync(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rCheckActivity requestCheckActivitySync
	if err := c.ShouldBindJSON(&rCheckActivity); err != nil {
		log.Error("[checkActivitySync] Invalid JSON Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	// Upsert Device
	if _, err := api.DB.Queries.UpsertDevice(api.DB.Ctx, database.UpsertDeviceParams{
		ID:         rCheckActivity.DeviceID,
		UserID:     rUser.(string),
		DeviceName: rCheckActivity.Device,
		LastSynced: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		log.Error("[checkActivitySync] UpsertDevice DB Error", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Device"})
		return
	}

	// Get Last Device Activity
	lastActivity, err := api.DB.Queries.GetLastActivity(api.DB.Ctx, database.GetLastActivityParams{
		UserID:   rUser.(string),
		DeviceID: rCheckActivity.DeviceID,
	})
	if err == sql.ErrNoRows {
		lastActivity = time.UnixMilli(0).Format(time.RFC3339)
	} else if err != nil {
		log.Error("[checkActivitySync] GetLastActivity DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Error"})
		return
	}

	// Parse Time
	parsedTime, err := time.Parse(time.RFC3339, lastActivity)
	if err != nil {
		log.Error("[checkActivitySync] Time Parse Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"last_sync": parsedTime.Unix(),
	})
}

func (api *API) addDocuments(c *gin.Context) {
	var rNewDocs requestDocument
	if err := c.ShouldBindJSON(&rNewDocs); err != nil {
		log.Error("[addDocuments] Invalid JSON Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Document(s)"})
		return
	}

	// Do Transaction
	tx, err := api.DB.DB.Begin()
	if err != nil {
		log.Error("[addDocuments] Transaction Begin DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Error"})
		return
	}

	// Defer & Start Transaction
	defer tx.Rollback()
	qtx := api.DB.Queries.WithTx(tx)

	// Upsert Documents
	for _, doc := range rNewDocs.Documents {
		doc, err := qtx.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
			ID:          doc.ID,
			Title:       api.sanitizeInput(doc.Title),
			Author:      api.sanitizeInput(doc.Author),
			Series:      api.sanitizeInput(doc.Series),
			SeriesIndex: doc.SeriesIndex,
			Lang:        api.sanitizeInput(doc.Lang),
			Description: api.sanitizeInput(doc.Description),
		})
		if err != nil {
			log.Error("[addDocuments] UpsertDocument DB Error:", err)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Document"})
			return
		}

		if _, err = qtx.UpdateDocumentSync(api.DB.Ctx, database.UpdateDocumentSyncParams{
			ID:     doc.ID,
			Synced: true,
		}); err != nil {
			log.Error("[addDocuments] UpdateDocumentSync DB Error:", err)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Document"})
			return
		}

	}

	// Commit Transaction
	if err := tx.Commit(); err != nil {
		log.Error("[addDocuments] Transaction Commit DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"changed": len(rNewDocs.Documents),
	})
}

func (api *API) checkDocumentsSync(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rCheckDocs requestCheckDocumentSync
	if err := c.ShouldBindJSON(&rCheckDocs); err != nil {
		log.Error("[checkDocumentsSync] Invalid JSON Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	// Upsert Device
	device, err := api.DB.Queries.UpsertDevice(api.DB.Ctx, database.UpsertDeviceParams{
		ID:         rCheckDocs.DeviceID,
		UserID:     rUser.(string),
		DeviceName: rCheckDocs.Device,
		LastSynced: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		log.Error("[checkDocumentsSync] UpsertDevice DB Error", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Device"})
		return
	}

	missingDocs := []database.Document{}
	deletedDocIDs := []string{}

	if device.Sync == true {
		// Get Missing Documents
		missingDocs, err = api.DB.Queries.GetMissingDocuments(api.DB.Ctx, rCheckDocs.Have)
		if err != nil {
			log.Error("[checkDocumentsSync] GetMissingDocuments DB Error", err)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
			return
		}

		// Get Deleted Documents
		deletedDocIDs, err = api.DB.Queries.GetDeletedDocuments(api.DB.Ctx, rCheckDocs.Have)
		if err != nil {
			log.Error("[checkDocumentsSync] GetDeletedDocuments DB Error", err)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
			return
		}
	}

	// Get Wanted Documents
	jsonHaves, err := json.Marshal(rCheckDocs.Have)
	if err != nil {
		log.Error("[checkDocumentsSync] JSON Marshal Error", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	wantedDocs, err := api.DB.Queries.GetWantedDocuments(api.DB.Ctx, string(jsonHaves))
	if err != nil {
		log.Error("[checkDocumentsSync] GetWantedDocuments DB Error", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
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

	c.JSON(http.StatusOK, rCheckDocSync)
}

func (api *API) uploadDocumentFile(c *gin.Context) {
	var rDoc requestDocumentID
	if err := c.ShouldBindUri(&rDoc); err != nil {
		log.Error("[uploadDocumentFile] Invalid URI Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	fileData, err := c.FormFile("file")
	if err != nil {
		log.Error("[uploadDocumentFile] File Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "File Error"})
		return
	}

	// Validate Type & Derive Extension on MIME
	uploadedFile, err := fileData.Open()
	fileMime, err := mimetype.DetectReader(uploadedFile)
	fileExtension := fileMime.Extension()

	if !slices.Contains([]string{".epub", ".html"}, fileExtension) {
		log.Error("[uploadDocumentFile] Invalid FileType:", fileExtension)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Filetype"})
		return
	}

	// Validate Document Exists in DB
	document, err := api.DB.Queries.GetDocument(api.DB.Ctx, rDoc.DocumentID)
	if err != nil {
		log.Error("[uploadDocumentFile] GetDocument DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Document"})
		return
	}

	// Derive Filename
	var fileName string
	if document.Author != nil {
		fileName = fileName + *document.Author
	} else {
		fileName = fileName + "Unknown"
	}

	if document.Title != nil {
		fileName = fileName + " - " + *document.Title
	} else {
		fileName = fileName + " - Unknown"
	}

	// Remove Slashes
	fileName = strings.ReplaceAll(fileName, "/", "")

	// Derive & Sanitize File Name
	fileName = "." + filepath.Clean(fmt.Sprintf("/%s [%s]%s", fileName, document.ID, fileExtension))

	// Generate Storage Path
	safePath := filepath.Join(api.Config.DataPath, "documents", fileName)

	// Save & Prevent Overwrites
	_, err = os.Stat(safePath)
	if os.IsNotExist(err) {
		err = c.SaveUploadedFile(fileData, safePath)
		if err != nil {
			log.Error("[uploadDocumentFile] Save Failure:", err)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "File Error"})
			return
		}
	}

	// Get MD5 Hash
	fileHash, err := getFileMD5(safePath)
	if err != nil {
		log.Error("[uploadDocumentFile] Hash Failure:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "File Error"})
		return
	}

	// Upsert Document
	if _, err = api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
		ID:       document.ID,
		Md5:      fileHash,
		Filepath: &fileName,
	}); err != nil {
		log.Error("[uploadDocumentFile] UpsertDocument DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Document Error"})
		return
	}

	// Update Document Sync Attribute
	if _, err = api.DB.Queries.UpdateDocumentSync(api.DB.Ctx, database.UpdateDocumentSyncParams{
		ID:     document.ID,
		Synced: true,
	}); err != nil {
		log.Error("[uploadDocumentFile] UpdateDocumentSync DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Document"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
	})
}

func (api *API) downloadDocumentFile(c *gin.Context) {
	var rDoc requestDocumentID
	if err := c.ShouldBindUri(&rDoc); err != nil {
		log.Error("[downloadDocumentFile] Invalid URI Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	// Get Document
	document, err := api.DB.Queries.GetDocument(api.DB.Ctx, rDoc.DocumentID)
	if err != nil {
		log.Error("[uploadDocumentFile] GetDocument DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Document"})
		return
	}

	if document.Filepath == nil {
		log.Error("[uploadDocumentFile] Document Doesn't Have File:", rDoc.DocumentID)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Document Doesn't Exist"})
		return
	}

	// Derive Storage Location
	filePath := filepath.Join(api.Config.DataPath, "documents", *document.Filepath)

	// Validate File Exists
	_, err = os.Stat(filePath)
	if os.IsNotExist(err) {
		log.Error("[uploadDocumentFile] File Doesn't Exist:", rDoc.DocumentID)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Document Doesn't Exists"})
		return
	}

	// Force Download (Security)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filepath.Base(*document.Filepath)))
	c.File(filePath)
}

func (api *API) sanitizeInput(val any) *string {
	switch v := val.(type) {
	case *string:
		if v != nil {
			newString := html.UnescapeString(api.HTMLPolicy.Sanitize(string(*v)))
			return &newString
		}
	case string:
		if v != "" {
			newString := html.UnescapeString(api.HTMLPolicy.Sanitize(string(v)))
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
