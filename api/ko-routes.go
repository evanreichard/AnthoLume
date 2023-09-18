package api

import (
	"crypto/md5"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	argon2 "github.com/alexedwards/argon2id"
	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"golang.org/x/exp/slices"
	"reichard.io/bbank/database"
)

type activityItem struct {
	DocumentID  string `json:"document"`
	StartTime   int64  `json:"start_time"`
	Duration    int64  `json:"duration"`
	CurrentPage int64  `json:"current_page"`
	TotalPages  int64  `json:"total_pages"`
}

type requestActivity struct {
	DeviceID string         `json:"device_id"`
	Device   string         `json:"device"`
	Activity []activityItem `json:"activity"`
}

type requestCheckActivitySync struct {
	DeviceID string `json:"device_id"`
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
	Want   []string            `json:"want"`
	Give   []database.Document `json:"give"`
	Delete []string            `json:"deleted"`
}

type requestDocumentID struct {
	DocumentID string `uri:"document" binding:"required"`
}

var allowedExtensions []string = []string{".epub", ".html"}

func (api *API) authorizeUser(c *gin.Context) {
	c.JSON(200, gin.H{
		"authorized": "OK",
	})
}

func (api *API) createUser(c *gin.Context) {
	var rUser requestUser
	if err := c.ShouldBindJSON(&rUser); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid User Data"})
		return
	}

	if rUser.Username == "" || rUser.Password == "" {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid User Data"})
		return
	}

	hashedPassword, err := argon2.CreateHash(rUser.Password, argon2.DefaultParams)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Error"})
		return
	}

	// TODO - Initial User is Admin & Enable / Disable Registration
	rows, err := api.DB.Queries.CreateUser(api.DB.Ctx, database.CreateUserParams{
		ID:   rUser.Username,
		Pass: hashedPassword,
	})

	// SQL Error
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid User Data"})
		return
	}

	// User Exists (ON CONFLICT DO NOTHING)
	if rows == 0 {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "User Already Exists"})
		return
	}

	// TODO: Struct -> JSON
	c.JSON(http.StatusCreated, gin.H{
		"username": rUser.Username,
	})
}

func (api *API) setProgress(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rPosition requestPosition
	if err := c.ShouldBindJSON(&rPosition); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Progress Data"})
		return
	}

	// Upsert Device
	device, err := api.DB.Queries.UpsertDevice(api.DB.Ctx, database.UpsertDeviceParams{
		ID:         rPosition.DeviceID,
		UserID:     rUser.(string),
		DeviceName: rPosition.Device,
	})
	if err != nil {
		log.Error("Device Upsert Error:", device, err)
	}

	// Upsert Document
	document, err := api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
		ID: rPosition.DocumentID,
	})
	if err != nil {
		log.Error("Document Upsert Error:", document, err)
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
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	// TODO: Struct -> JSON
	c.JSON(http.StatusOK, gin.H{
		"document":  progress.DocumentID,
		"timestamp": progress.CreatedAt,
	})
}

func (api *API) getProgress(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	progress, err := api.DB.Queries.GetProgress(api.DB.Ctx, database.GetProgressParams{
		DocumentID: rDocID.DocumentID,
		UserID:     rUser.(string),
	})

	if err != nil {
		log.Error("Invalid Progress:", progress, err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Document"})
		return
	}

	// TODO: Struct -> JSON
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
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Activity"})
		return
	}

	// Do Transaction
	tx, err := api.DB.DB.Begin()
	if err != nil {
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
		_, err := qtx.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
			ID: doc,
		})

		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Document"})
			return
		}
	}

	// Upsert Device
	_, err = qtx.UpsertDevice(api.DB.Ctx, database.UpsertDeviceParams{
		ID:         rActivity.DeviceID,
		UserID:     rUser.(string),
		DeviceName: rActivity.Device,
	})
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Device"})
		return
	}

	// Add All Activity
	for _, item := range rActivity.Activity {
		_, err := qtx.AddActivity(api.DB.Ctx, database.AddActivityParams{
			UserID:      rUser.(string),
			DocumentID:  item.DocumentID,
			DeviceID:    rActivity.DeviceID,
			StartTime:   time.Unix(int64(item.StartTime), 0).UTC(),
			Duration:    int64(item.Duration),
			CurrentPage: int64(item.CurrentPage),
			TotalPages:  int64(item.TotalPages),
		})

		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Activity"})
			return
		}
	}

	// Commit Transaction
	tx.Commit()

	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Document"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"added": len(rActivity.Activity),
	})
}

func (api *API) checkActivitySync(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rCheckActivity requestCheckActivitySync
	if err := c.ShouldBindJSON(&rCheckActivity); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	// Get Last Device Activity
	lastActivity, err := api.DB.Queries.GetLastActivity(api.DB.Ctx, database.GetLastActivityParams{
		UserID:   rUser.(string),
		DeviceID: rCheckActivity.DeviceID,
	})
	if err == sql.ErrNoRows {
		lastActivity = time.UnixMilli(0)
	} else if err != nil {
		log.Error("GetLastActivity Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"last_sync": lastActivity.Unix(),
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
		log.Error("[addDocuments] Unknown Transaction Error")
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
			Title:       doc.Title,
			Author:      doc.Author,
			Series:      doc.Series,
			SeriesIndex: doc.SeriesIndex,
			Lang:        doc.Lang,
			Description: doc.Description,
		})
		if err != nil {
			log.Error("[addDocuments] UpsertDocument Error:", err)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Document"})
			return
		}

		_, err = qtx.UpdateDocumentSync(api.DB.Ctx, database.UpdateDocumentSyncParams{
			ID:     doc.ID,
			Synced: true,
		})
		if err != nil {
			log.Error("[addDocuments] UpsertDocumentSync Error:", err)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Document"})
			return
		}

	}

	// Commit Transaction
	tx.Commit()

	c.JSON(http.StatusOK, gin.H{
		"changed": len(rNewDocs.Documents),
	})
}

func (api *API) checkDocumentsSync(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rCheckDocs requestCheckDocumentSync
	if err := c.ShouldBindJSON(&rCheckDocs); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	// Upsert Device
	device, err := api.DB.Queries.UpsertDevice(api.DB.Ctx, database.UpsertDeviceParams{
		ID:         rCheckDocs.DeviceID,
		UserID:     rUser.(string),
		DeviceName: rCheckDocs.Device,
	})
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Device"})
		return
	}

	missingDocs := []database.Document{}
	deletedDocIDs := []string{}

	if device.Sync == true {
		// Get Missing Documents
		missingDocs, err = api.DB.Queries.GetMissingDocuments(api.DB.Ctx, rCheckDocs.Have)
		if err != nil {
			log.Error("GetMissingDocuments Error:", err)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
			return
		}

		// Get Deleted Documents
		deletedDocIDs, err = api.DB.Queries.GetDeletedDocuments(api.DB.Ctx, rCheckDocs.Have)
		if err != nil {
			log.Error("GetDeletedDocuements Error:", err)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
			return
		}
	}

	// Get Wanted Documents
	jsonHaves, err := json.Marshal(rCheckDocs.Have)
	if err != nil {
		log.Error("JSON Marshal Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	wantedDocIDs, err := api.DB.Queries.GetWantedDocuments(api.DB.Ctx, string(jsonHaves))
	if err != nil {
		log.Error("GetWantedDocuments Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	rCheckDocSync := responseCheckDocumentSync{
		Delete: []string{},
		Want:   []string{},
		Give:   []database.Document{},
	}

	// Ensure Empty Array
	if wantedDocIDs != nil {
		rCheckDocSync.Want = wantedDocIDs
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
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	fileData, err := c.FormFile("file")
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "File Error"})
		return
	}

	// Validate Type & Derive Extension on MIME
	uploadedFile, err := fileData.Open()
	fileMime, err := mimetype.DetectReader(uploadedFile)
	fileExtension := fileMime.Extension()

	if !slices.Contains(allowedExtensions, fileExtension) {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Filetype"})
		return
	}

	// Validate Document Exists in DB
	document, err := api.DB.Queries.GetDocument(api.DB.Ctx, rDoc.DocumentID)
	if err != nil {
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

	// Derive & Sanitize File Name
	fileName = "." + filepath.Clean(fmt.Sprintf("/%s [%s]%s", fileName, document.ID, fileExtension))

	// Generate Storage Path
	safePath := filepath.Join(api.Config.DataPath, "documents", fileName)

	// Save & Prevent Overwrites
	_, err = os.Stat(safePath)
	if os.IsNotExist(err) {
		err = c.SaveUploadedFile(fileData, safePath)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "File Error"})
			return
		}
	}

	// Get MD5 Hash
	fileHash, err := getFileMD5(safePath)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "File Error"})
		return
	}

	// Upsert Document
	_, err = api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
		ID:       document.ID,
		Md5:      fileHash,
		Filepath: &fileName,
	})
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Document Error"})
		return
	}

	// Update Document Sync Attribute
	_, err = api.DB.Queries.UpdateDocumentSync(api.DB.Ctx, database.UpdateDocumentSyncParams{
		ID:     document.ID,
		Synced: true,
	})
	if err != nil {
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
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	// Get Document
	document, err := api.DB.Queries.GetDocument(api.DB.Ctx, rDoc.DocumentID)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Document"})
		return
	}

	if document.Filepath == nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Document Doesn't Exist"})
		return
	}

	// Derive Storage Location
	filePath := filepath.Join(api.Config.DataPath, "documents", *document.Filepath)

	// Validate File Exists
	_, err = os.Stat(filePath)
	if os.IsNotExist(err) {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Document Doesn't Exists"})
		return
	}

	// Force Download (Security)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filepath.Base(*document.Filepath)))
	c.File(filePath)
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
