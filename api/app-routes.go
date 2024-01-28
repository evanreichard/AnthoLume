package api

import (
	"archive/zip"
	"bufio"
	"crypto/md5"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"

	argon2 "github.com/alexedwards/argon2id"
	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"golang.org/x/exp/slices"
	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/search"
	"reichard.io/antholume/utils"
)

type adminAction string

const (
	adminImport        adminAction = "IMPORT"
	adminBackup        adminAction = "BACKUP"
	adminRestore       adminAction = "RESTORE"
	adminMetadataMatch adminAction = "METADATA_MATCH"
	adminCacheTables   adminAction = "CACHE_TABLES"
)

type importType string

const (
	importDirect importType = "DIRECT"
	importCopy   importType = "COPY"
)

type backupType string

const (
	backupCovers    backupType = "COVERS"
	backupDocuments backupType = "DOCUMENTS"
)

type queryParams struct {
	Page     *int64  `form:"page"`
	Limit    *int64  `form:"limit"`
	Search   *string `form:"search"`
	Document *string `form:"document"`
}

type searchParams struct {
	Query  *string        `form:"query"`
	Source *search.Source `form:"source"`
}

type requestDocumentUpload struct {
	DocumentFile *multipart.FileHeader `form:"document_file"`
}

type requestDocumentEdit struct {
	Title       *string               `form:"title"`
	Author      *string               `form:"author"`
	Description *string               `form:"description"`
	ISBN10      *string               `form:"isbn_10"`
	ISBN13      *string               `form:"isbn_13"`
	RemoveCover *string               `form:"remove_cover"`
	CoverGBID   *string               `form:"cover_gbid"`
	CoverFile   *multipart.FileHeader `form:"cover_file"`
}

type requestAdminAction struct {
	Action adminAction `form:"action"`

	// Import Action
	ImportDirectory *string     `form:"import_directory"`
	ImportType      *importType `form:"import_type"`

	// Backup Action
	BackupTypes []backupType `form:"backup_types"`

	// Restore Action
	RestoreFile *multipart.FileHeader `form:"restore_file"`
}

type requestDocumentIdentify struct {
	Title  *string `form:"title"`
	Author *string `form:"author"`
	ISBN   *string `form:"isbn"`
}

type requestSettingsEdit struct {
	Password    *string `form:"password"`
	NewPassword *string `form:"new_password"`
	TimeOffset  *string `form:"time_offset"`
}

type requestDocumentAdd struct {
	ID     string        `form:"id"`
	Title  *string       `form:"title"`
	Author *string       `form:"author"`
	Source search.Source `form:"source"`
}

func (api *API) appWebManifest(c *gin.Context) {
	c.Header("Content-Type", "application/manifest+json")
	c.FileFromFS("assets/manifest.json", http.FS(api.assets))
}

func (api *API) appServiceWorker(c *gin.Context) {
	c.FileFromFS("assets/sw.js", http.FS(api.assets))
}

func (api *API) appFaviconIcon(c *gin.Context) {
	c.FileFromFS("assets/icons/favicon.ico", http.FS(api.assets))
}

func (api *API) appLocalDocuments(c *gin.Context) {
	c.FileFromFS("assets/local/index.htm", http.FS(api.assets))
}

func (api *API) appDocumentReader(c *gin.Context) {
	c.FileFromFS("assets/reader/index.htm", http.FS(api.assets))
}

func (api *API) appGetDocuments(c *gin.Context) {
	templateVars, auth := api.getBaseTemplateVars("documents", c)
	qParams := bindQueryParams(c, 9)

	var query *string
	if qParams.Search != nil && *qParams.Search != "" {
		search := "%" + *qParams.Search + "%"
		query = &search
	}

	documents, err := api.db.Queries.GetDocumentsWithStats(api.db.Ctx, database.GetDocumentsWithStatsParams{
		UserID: auth.UserName,
		Query:  query,
		Offset: (*qParams.Page - 1) * *qParams.Limit,
		Limit:  *qParams.Limit,
	})
	if err != nil {
		log.Error("GetDocumentsWithStats DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentsWithStats DB Error: %v", err))
		return
	}

	length, err := api.db.Queries.GetDocumentsSize(api.db.Ctx, query)
	if err != nil {
		log.Error("GetDocumentsSize DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentsSize DB Error: %v", err))
		return
	}

	if err = api.getDocumentsWordCount(documents); err != nil {
		log.Error("Unable to Get Word Counts: ", err)
	}

	totalPages := int64(math.Ceil(float64(length) / float64(*qParams.Limit)))
	nextPage := *qParams.Page + 1
	previousPage := *qParams.Page - 1

	if nextPage <= totalPages {
		templateVars["NextPage"] = nextPage
	}

	if previousPage >= 0 {
		templateVars["PreviousPage"] = previousPage
	}

	templateVars["PageLimit"] = *qParams.Limit
	templateVars["Data"] = documents

	c.HTML(http.StatusOK, "page/documents", templateVars)
}

func (api *API) appGetDocument(c *gin.Context) {
	templateVars, auth := api.getBaseTemplateVars("document", c)

	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	document, err := api.db.Queries.GetDocumentWithStats(api.db.Ctx, database.GetDocumentWithStatsParams{
		UserID:     auth.UserName,
		DocumentID: rDocID.DocumentID,
	})
	if err != nil {
		log.Error("GetDocumentWithStats DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentsWithStats DB Error: %v", err))
		return
	}

	templateVars["Data"] = document
	templateVars["TotalTimeLeftSeconds"] = int64((100.0 - document.Percentage) * float64(document.SecondsPerPercent))

	c.HTML(http.StatusOK, "page/document", templateVars)
}

func (api *API) appGetProgress(c *gin.Context) {
	templateVars, auth := api.getBaseTemplateVars("progress", c)

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

	progress, err := api.db.Queries.GetProgress(api.db.Ctx, progressFilter)
	if err != nil {
		log.Error("GetProgress DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetActivity DB Error: %v", err))
		return
	}

	templateVars["Data"] = progress

	c.HTML(http.StatusOK, "page/progress", templateVars)
}

func (api *API) appGetActivity(c *gin.Context) {
	templateVars, auth := api.getBaseTemplateVars("activity", c)
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

	activity, err := api.db.Queries.GetActivity(api.db.Ctx, activityFilter)
	if err != nil {
		log.Error("GetActivity DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetActivity DB Error: %v", err))
		return
	}

	templateVars["Data"] = activity

	c.HTML(http.StatusOK, "page/activity", templateVars)
}

func (api *API) appGetHome(c *gin.Context) {
	templateVars, auth := api.getBaseTemplateVars("home", c)

	start := time.Now()
	graphData, err := api.db.Queries.GetDailyReadStats(api.db.Ctx, auth.UserName)
	if err != nil {
		log.Error("GetDailyReadStats DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDailyReadStats DB Error: %v", err))
		return
	}
	log.Debug("GetDailyReadStats DB Performance: ", time.Since(start))

	start = time.Now()
	databaseInfo, err := api.db.Queries.GetDatabaseInfo(api.db.Ctx, auth.UserName)
	if err != nil {
		log.Error("GetDatabaseInfo DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDatabaseInfo DB Error: %v", err))
		return
	}
	log.Debug("GetDatabaseInfo DB Performance: ", time.Since(start))

	start = time.Now()
	streaks, err := api.db.Queries.GetUserStreaks(api.db.Ctx, auth.UserName)
	if err != nil {
		log.Error("GetUserStreaks DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUserStreaks DB Error: %v", err))
		return
	}
	log.Debug("GetUserStreaks DB Performance: ", time.Since(start))

	start = time.Now()
	userStatistics, err := api.db.Queries.GetUserStatistics(api.db.Ctx)
	if err != nil {
		log.Error("GetUserStatistics DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUserStatistics DB Error: %v", err))
		return
	}
	log.Debug("GetUserStatistics DB Performance: ", time.Since(start))

	templateVars["Data"] = gin.H{
		"Streaks":        streaks,
		"GraphData":      graphData,
		"DatabaseInfo":   databaseInfo,
		"UserStatistics": arrangeUserStatistics(userStatistics),
	}

	c.HTML(http.StatusOK, "page/home", templateVars)
}

func (api *API) appGetSettings(c *gin.Context) {
	templateVars, auth := api.getBaseTemplateVars("settings", c)

	user, err := api.db.Queries.GetUser(api.db.Ctx, auth.UserName)
	if err != nil {
		log.Error("GetUser DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUser DB Error: %v", err))
		return
	}

	devices, err := api.db.Queries.GetDevices(api.db.Ctx, auth.UserName)
	if err != nil {
		log.Error("GetDevices DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDevices DB Error: %v", err))
		return
	}

	templateVars["Data"] = gin.H{
		"TimeOffset": *user.TimeOffset,
		"Devices":    devices,
	}

	c.HTML(http.StatusOK, "page/settings", templateVars)
}

func (api *API) appGetAdmin(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin", c)
	c.HTML(http.StatusOK, "page/admin", templateVars)
}

func (api *API) appGetAdminLogs(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin-logs", c)

	// Open Log File
	logPath := filepath.Join(api.cfg.ConfigPath, "logs/antholume.log")
	logFile, err := os.Open(logPath)
	if err != nil {
		appErrorPage(c, http.StatusBadRequest, "Missing AnthoLume log file.")
		return
	}
	defer logFile.Close()

	// Log Lines
	var logLines []string
	scanner := bufio.NewScanner(logFile)
	for scanner.Scan() {
		rawLog := scanner.Text()

		// Attempt JSON Pretty
		var jsonMap map[string]interface{}
		err := json.Unmarshal([]byte(rawLog), &jsonMap)
		if err != nil {
			logLines = append(logLines, scanner.Text())
			continue
		}

		prettyJSON, err := json.MarshalIndent(jsonMap, "", "  ")
		if err != nil {
			logLines = append(logLines, scanner.Text())
			continue
		}

		logLines = append(logLines, string(prettyJSON))
	}
	templateVars["Data"] = logLines

	c.HTML(http.StatusOK, "page/admin-logs", templateVars)
}

func (api *API) appGetAdminUsers(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin-users", c)

	users, err := api.db.Queries.GetUsers(api.db.Ctx)
	if err != nil {
		log.Error("GetUsers DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUsers DB Error: %v", err))
		return
	}

	templateVars["Data"] = users

	c.HTML(http.StatusOK, "page/admin-users", templateVars)
}

// Tabs:
//   - General (Import, Backup & Restore, Version (githash?), Stats?)
//   - Users
//   - Metadata
func (api *API) appPerformAdminAction(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin", c)

	var rAdminAction requestAdminAction
	if err := c.ShouldBind(&rAdminAction); err != nil {
		log.Error("Invalid Form Bind: ", err)
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	switch rAdminAction.Action {
	case adminImport:
		// TODO
	case adminMetadataMatch:
		// TODO
		// 1. Documents xref most recent metadata table?
		// 2. Select all / deselect?
	case adminCacheTables:
		go api.db.CacheTempTables()
	case adminRestore:
		api.processRestoreFile(rAdminAction, c)
	case adminBackup:
		// Vacuum
		_, err := api.db.DB.ExecContext(api.db.Ctx, "VACUUM;")
		if err != nil {
			log.Error("Unable to vacuum DB: ", err)
			appErrorPage(c, http.StatusInternalServerError, "Unable to vacuum database.")
			return
		}

		// Set Headers
		c.Header("Content-type", "application/octet-stream")
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"AnthoLumeBackup_%s.zip\"", time.Now().Format("20060102150405")))

		// Stream Backup ZIP Archive
		c.Stream(func(w io.Writer) bool {
			var directories []string
			for _, item := range rAdminAction.BackupTypes {
				if item == backupCovers {
					directories = append(directories, "covers")
				} else if item == backupDocuments {
					directories = append(directories, "documents")
				}
			}

			err := api.createBackup(w, directories)
			if err != nil {
				log.Error("Backup Error: ", err)
			}
			return false
		})

		return
	}

	c.HTML(http.StatusOK, "page/admin", templateVars)
}

func (api *API) appGetSearch(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("search", c)

	var sParams searchParams
	c.BindQuery(&sParams)

	// Only Handle Query
	if sParams.Query != nil && sParams.Source != nil {
		// Search
		searchResults, err := search.SearchBook(*sParams.Query, *sParams.Source)
		if err != nil {
			appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Search Error: %v", err))
			return
		}

		templateVars["Data"] = searchResults
		templateVars["Source"] = *sParams.Source
	} else if sParams.Query != nil || sParams.Source != nil {
		templateVars["SearchErrorMessage"] = "Invalid Query"
	}

	c.HTML(http.StatusOK, "page/search", templateVars)
}

func (api *API) appGetLogin(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("login", c)
	templateVars["RegistrationEnabled"] = api.cfg.RegistrationEnabled
	c.HTML(http.StatusOK, "page/login", templateVars)
}

func (api *API) appGetRegister(c *gin.Context) {
	if !api.cfg.RegistrationEnabled {
		c.Redirect(http.StatusFound, "/login")
		return
	}

	templateVars, _ := api.getBaseTemplateVars("login", c)
	templateVars["RegistrationEnabled"] = api.cfg.RegistrationEnabled
	templateVars["Register"] = true
	c.HTML(http.StatusOK, "page/login", templateVars)
}

func (api *API) appGetDocumentProgress(c *gin.Context) {
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	var rDoc requestDocumentID
	if err := c.ShouldBindUri(&rDoc); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	progress, err := api.db.Queries.GetDocumentProgress(api.db.Ctx, database.GetDocumentProgressParams{
		DocumentID: rDoc.DocumentID,
		UserID:     auth.UserName,
	})

	if err != nil && err != sql.ErrNoRows {
		log.Error("UpsertDocument DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpsertDocument DB Error: %v", err))
		return
	}

	document, err := api.db.Queries.GetDocumentWithStats(api.db.Ctx, database.GetDocumentWithStatsParams{
		UserID:     auth.UserName,
		DocumentID: rDoc.DocumentID,
	})
	if err != nil {
		log.Error("GetDocumentWithStats DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentWithStats DB Error: %v", err))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":         document.ID,
		"title":      document.Title,
		"author":     document.Author,
		"words":      document.Words,
		"progress":   progress.Progress,
		"percentage": document.Percentage,
	})
}

func (api *API) appGetDevices(c *gin.Context) {
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	devices, err := api.db.Queries.GetDevices(api.db.Ctx, auth.UserName)

	if err != nil && err != sql.ErrNoRows {
		log.Error("GetDevices DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDevices DB Error: %v", err))
		return
	}

	c.JSON(http.StatusOK, devices)
}

func (api *API) appUploadNewDocument(c *gin.Context) {
	var rDocUpload requestDocumentUpload
	if err := c.ShouldBind(&rDocUpload); err != nil {
		log.Error("Invalid Form Bind")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	if rDocUpload.DocumentFile == nil {
		c.Redirect(http.StatusFound, "./documents")
		return
	}

	// Validate Type & Derive Extension on MIME
	uploadedFile, err := rDocUpload.DocumentFile.Open()
	if err != nil {
		log.Error("File Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to open file.")
		return
	}

	fileMime, err := mimetype.DetectReader(uploadedFile)
	if err != nil {
		log.Error("MIME Error")
		appErrorPage(c, http.StatusInternalServerError, "Unable to detect filetype.")
		return
	}
	fileExtension := fileMime.Extension()

	// Validate Extension
	if !slices.Contains([]string{".epub"}, fileExtension) {
		log.Error("Invalid FileType: ", fileExtension)
		appErrorPage(c, http.StatusBadRequest, "Invalid filetype.")
		return
	}

	// Create Temp File
	tempFile, err := os.CreateTemp("", "book")
	if err != nil {
		log.Warn("Temp File Create Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to create temp file.")
		return
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Save Temp
	err = c.SaveUploadedFile(rDocUpload.DocumentFile, tempFile.Name())
	if err != nil {
		log.Error("File Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}

	// Get Metadata
	metadataInfo, err := metadata.GetMetadata(tempFile.Name())
	if err != nil {
		log.Warn("GetMetadata Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to acquire file metadata.")
		return
	}

	// Calculate Partial MD5 ID
	partialMD5, err := utils.CalculatePartialMD5(tempFile.Name())
	if err != nil {
		log.Warn("Partial MD5 Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to calculate partial MD5.")
		return
	}

	// Check Exists
	_, err = api.db.Queries.GetDocument(api.db.Ctx, partialMD5)
	if err == nil {
		c.Redirect(http.StatusFound, fmt.Sprintf("./documents/%s", partialMD5))
		return
	}

	// Calculate Actual MD5
	fileHash, err := getFileMD5(tempFile.Name())
	if err != nil {
		log.Error("MD5 Hash Failure: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to calculate MD5.")
		return
	}

	// Get Word Count
	wordCount, err := metadata.GetWordCount(tempFile.Name())
	if err != nil {
		log.Error("Word Count Failure: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to calculate word count.")
		return
	}

	// Derive Filename
	var fileName string
	if *metadataInfo.Author != "" {
		fileName = fileName + *metadataInfo.Author
	} else {
		fileName = fileName + "Unknown"
	}

	if *metadataInfo.Title != "" {
		fileName = fileName + " - " + *metadataInfo.Title
	} else {
		fileName = fileName + " - Unknown"
	}

	// Remove Slashes
	fileName = strings.ReplaceAll(fileName, "/", "")

	// Derive & Sanitize File Name
	fileName = "." + filepath.Clean(fmt.Sprintf("/%s [%s]%s", fileName, partialMD5, fileExtension))

	// Generate Storage Path & Open File
	safePath := filepath.Join(api.cfg.DataPath, "documents", fileName)
	destFile, err := os.Create(safePath)
	if err != nil {
		log.Error("Dest File Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}
	defer destFile.Close()

	// Copy File
	if _, err = io.Copy(destFile, tempFile); err != nil {
		log.Error("Copy Temp File Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}

	// Upsert Document
	if _, err = api.db.Queries.UpsertDocument(api.db.Ctx, database.UpsertDocumentParams{
		ID:          partialMD5,
		Title:       metadataInfo.Title,
		Author:      metadataInfo.Author,
		Description: metadataInfo.Description,
		Words:       &wordCount,
		Md5:         fileHash,
		Filepath:    &fileName,
	}); err != nil {
		log.Error("UpsertDocument DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpsertDocument DB Error: %v", err))
		return
	}

	c.Redirect(http.StatusFound, fmt.Sprintf("./documents/%s", partialMD5))
}

func (api *API) appEditDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	var rDocEdit requestDocumentEdit
	if err := c.ShouldBind(&rDocEdit); err != nil {
		log.Error("Invalid Form Bind")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	// Validate Something Exists
	if rDocEdit.Author == nil &&
		rDocEdit.Title == nil &&
		rDocEdit.Description == nil &&
		rDocEdit.ISBN10 == nil &&
		rDocEdit.ISBN13 == nil &&
		rDocEdit.RemoveCover == nil &&
		rDocEdit.CoverGBID == nil &&
		rDocEdit.CoverFile == nil {
		log.Error("Missing Form Values")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	// Handle Cover
	var coverFileName *string
	if rDocEdit.RemoveCover != nil && *rDocEdit.RemoveCover == "on" {
		s := "UNKNOWN"
		coverFileName = &s
	} else if rDocEdit.CoverFile != nil {
		// Validate Type & Derive Extension on MIME
		uploadedFile, err := rDocEdit.CoverFile.Open()
		if err != nil {
			log.Error("File Error")
			appErrorPage(c, http.StatusInternalServerError, "Unable to open file.")
			return
		}

		fileMime, err := mimetype.DetectReader(uploadedFile)
		if err != nil {
			log.Error("MIME Error")
			appErrorPage(c, http.StatusInternalServerError, "Unable to detect filetype.")
			return
		}
		fileExtension := fileMime.Extension()

		// Validate Extension
		if !slices.Contains([]string{".jpg", ".png"}, fileExtension) {
			log.Error("Invalid FileType: ", fileExtension)
			appErrorPage(c, http.StatusBadRequest, "Invalid filetype.")
			return
		}

		// Generate Storage Path
		fileName := fmt.Sprintf("%s%s", rDocID.DocumentID, fileExtension)
		safePath := filepath.Join(api.cfg.DataPath, "covers", fileName)

		// Save
		err = c.SaveUploadedFile(rDocEdit.CoverFile, safePath)
		if err != nil {
			log.Error("File Error: ", err)
			appErrorPage(c, http.StatusInternalServerError, "Unable to save file.")
			return
		}

		coverFileName = &fileName
	} else if rDocEdit.CoverGBID != nil {
		var coverDir string = filepath.Join(api.cfg.DataPath, "covers")
		fileName, err := metadata.CacheCover(*rDocEdit.CoverGBID, coverDir, rDocID.DocumentID, true)
		if err == nil {
			coverFileName = fileName
		}
	}

	// Update Document
	if _, err := api.db.Queries.UpsertDocument(api.db.Ctx, database.UpsertDocumentParams{
		ID:          rDocID.DocumentID,
		Title:       api.sanitizeInput(rDocEdit.Title),
		Author:      api.sanitizeInput(rDocEdit.Author),
		Description: api.sanitizeInput(rDocEdit.Description),
		Isbn10:      api.sanitizeInput(rDocEdit.ISBN10),
		Isbn13:      api.sanitizeInput(rDocEdit.ISBN13),
		Coverfile:   coverFileName,
	}); err != nil {
		log.Error("UpsertDocument DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpsertDocument DB Error: %v", err))
		return
	}

	c.Redirect(http.StatusFound, "./")
	return
}

func (api *API) appDeleteDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}
	changed, err := api.db.Queries.DeleteDocument(api.db.Ctx, rDocID.DocumentID)
	if err != nil {
		log.Error("DeleteDocument DB Error")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("DeleteDocument DB Error: %v", err))
		return
	}
	if changed == 0 {
		log.Error("DeleteDocument DB Error")
		appErrorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	c.Redirect(http.StatusFound, "../")
}

func (api *API) appIdentifyDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	var rDocIdentify requestDocumentIdentify
	if err := c.ShouldBind(&rDocIdentify); err != nil {
		log.Error("Invalid Form Bind")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
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
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	// Get Template Variables
	templateVars, auth := api.getBaseTemplateVars("document", c)

	// Get Metadata
	metadataResults, err := metadata.SearchMetadata(metadata.GBOOK, metadata.MetadataInfo{
		Title:  rDocIdentify.Title,
		Author: rDocIdentify.Author,
		ISBN10: rDocIdentify.ISBN,
		ISBN13: rDocIdentify.ISBN,
	})
	if err == nil && len(metadataResults) > 0 {
		firstResult := metadataResults[0]

		// Store First Metadata Result
		if _, err = api.db.Queries.AddMetadata(api.db.Ctx, database.AddMetadataParams{
			DocumentID:  rDocID.DocumentID,
			Title:       firstResult.Title,
			Author:      firstResult.Author,
			Description: firstResult.Description,
			Gbid:        firstResult.ID,
			Olid:        nil,
			Isbn10:      firstResult.ISBN10,
			Isbn13:      firstResult.ISBN13,
		}); err != nil {
			log.Error("AddMetadata DB Error: ", err)
		}

		templateVars["Metadata"] = firstResult
	} else {
		log.Warn("Metadata Error")
		templateVars["MetadataError"] = "No Metadata Found"
	}

	document, err := api.db.Queries.GetDocumentWithStats(api.db.Ctx, database.GetDocumentWithStatsParams{
		UserID:     auth.UserName,
		DocumentID: rDocID.DocumentID,
	})
	if err != nil {
		log.Error("GetDocumentWithStats DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentWithStats DB Error: %v", err))
		return
	}

	templateVars["Data"] = document
	templateVars["TotalTimeLeftSeconds"] = int64((100.0 - document.Percentage) * float64(document.SecondsPerPercent))

	c.HTML(http.StatusOK, "page/document", templateVars)
}

func (api *API) appSaveNewDocument(c *gin.Context) {
	var rDocAdd requestDocumentAdd
	if err := c.ShouldBind(&rDocAdd); err != nil {
		log.Error("Invalid Form Bind")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	// Render Initial Template
	templateVars, _ := api.getBaseTemplateVars("search", c)
	c.HTML(http.StatusOK, "page/search", templateVars)

	// Create Streamer
	stream := api.newStreamer(c, `
	  <div class="absolute top-0 left-0 w-full h-full z-50">
	    <div class="fixed top-0 left-0 bg-black opacity-50 w-screen h-screen"></div>
	    <div id="stream-main" class="relative max-h-[95%] -translate-x-2/4 top-1/2 left-1/2 w-5/6">`)
	defer stream.close(`</div></div>`)

	// Stream Helper Function
	sendDownloadMessage := func(msg string, args ...map[string]any) {
		// Merge Defaults & Overrides
		var templateVars = gin.H{
			"Message":    msg,
			"ButtonText": "Close",
			"ButtonHref": "./search",
		}
		if len(args) > 0 {
			for key := range args[0] {
				templateVars[key] = args[0][key]
			}
		}

		stream.send("component/download-progress", templateVars)
	}

	// Send Message
	sendDownloadMessage("Downloading document...", gin.H{"Progress": 10})

	// Save Book
	tempFilePath, err := search.SaveBook(rDocAdd.ID, rDocAdd.Source)
	if err != nil {
		log.Warn("Temp File Error: ", err)
		sendDownloadMessage("Unable to download file", gin.H{"Error": true})
		return
	}

	// Send Message
	sendDownloadMessage("Calculating partial MD5...", gin.H{"Progress": 60})

	// Calculate Partial MD5 ID
	partialMD5, err := utils.CalculatePartialMD5(tempFilePath)
	if err != nil {
		log.Warn("Partial MD5 Error: ", err)
		sendDownloadMessage("Unable to calculate partial MD5", gin.H{"Error": true})
	}

	// Send Message
	sendDownloadMessage("Saving file...", gin.H{"Progress": 60})

	// Derive Extension on MIME
	fileMime, err := mimetype.DetectFile(tempFilePath)
	fileExtension := fileMime.Extension()

	// Derive Filename
	var fileName string
	if *rDocAdd.Author != "" {
		fileName = fileName + *rDocAdd.Author
	} else {
		fileName = fileName + "Unknown"
	}

	if *rDocAdd.Title != "" {
		fileName = fileName + " - " + *rDocAdd.Title
	} else {
		fileName = fileName + " - Unknown"
	}

	// Remove Slashes
	fileName = strings.ReplaceAll(fileName, "/", "")

	// Derive & Sanitize File Name
	fileName = "." + filepath.Clean(fmt.Sprintf("/%s [%s]%s", fileName, partialMD5, fileExtension))

	// Open Source File
	sourceFile, err := os.Open(tempFilePath)
	if err != nil {
		log.Error("Source File Error: ", err)
		sendDownloadMessage("Unable to open file", gin.H{"Error": true})
		return
	}
	defer os.Remove(tempFilePath)
	defer sourceFile.Close()

	// Generate Storage Path & Open File
	safePath := filepath.Join(api.cfg.DataPath, "documents", fileName)
	destFile, err := os.Create(safePath)
	if err != nil {
		log.Error("Dest File Error: ", err)
		sendDownloadMessage("Unable to create file", gin.H{"Error": true})
		return
	}
	defer destFile.Close()

	// Copy File
	if _, err = io.Copy(destFile, sourceFile); err != nil {
		log.Error("Copy Temp File Error: ", err)
		sendDownloadMessage("Unable to save file", gin.H{"Error": true})
		return
	}

	// Send Message
	sendDownloadMessage("Calculating MD5...", gin.H{"Progress": 70})

	// Get MD5 Hash
	fileHash, err := getFileMD5(safePath)
	if err != nil {
		log.Error("Hash Failure: ", err)
		sendDownloadMessage("Unable to calculate MD5", gin.H{"Error": true})
		return
	}

	// Send Message
	sendDownloadMessage("Calculating word count...", gin.H{"Progress": 80})

	// Get Word Count
	wordCount, err := metadata.GetWordCount(safePath)
	if err != nil {
		log.Error("Word Count Failure: ", err)
		sendDownloadMessage("Unable to calculate word count", gin.H{"Error": true})
		return
	}

	// Send Message
	sendDownloadMessage("Saving to database...", gin.H{"Progress": 90})

	// Upsert Document
	if _, err = api.db.Queries.UpsertDocument(api.db.Ctx, database.UpsertDocumentParams{
		ID:       partialMD5,
		Title:    rDocAdd.Title,
		Author:   rDocAdd.Author,
		Md5:      fileHash,
		Filepath: &fileName,
		Words:    &wordCount,
	}); err != nil {
		log.Error("UpsertDocument DB Error: ", err)
		sendDownloadMessage("Unable to save to database", gin.H{"Error": true})
		return
	}

	// Send Message
	sendDownloadMessage("Download Success", gin.H{
		"Progress":   100,
		"ButtonText": "Go to Book",
		"ButtonHref": fmt.Sprintf("./documents/%s", partialMD5),
	})
}

func (api *API) appEditSettings(c *gin.Context) {
	var rUserSettings requestSettingsEdit
	if err := c.ShouldBind(&rUserSettings); err != nil {
		log.Error("Invalid Form Bind")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	// Validate Something Exists
	if rUserSettings.Password == nil && rUserSettings.NewPassword == nil && rUserSettings.TimeOffset == nil {
		log.Error("Missing Form Values")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	templateVars, auth := api.getBaseTemplateVars("settings", c)

	newUserSettings := database.UpdateUserParams{
		UserID: auth.UserName,
	}

	// Set New Password
	if rUserSettings.Password != nil && rUserSettings.NewPassword != nil {
		password := fmt.Sprintf("%x", md5.Sum([]byte(*rUserSettings.Password)))
		data := api.authorizeCredentials(auth.UserName, password)
		if data == nil {
			templateVars["PasswordErrorMessage"] = "Invalid Password"
		} else {
			password := fmt.Sprintf("%x", md5.Sum([]byte(*rUserSettings.NewPassword)))
			hashedPassword, err := argon2.CreateHash(password, argon2.DefaultParams)
			if err != nil {
				templateVars["PasswordErrorMessage"] = "Unknown Error"
			} else {
				templateVars["PasswordMessage"] = "Password Updated"
				newUserSettings.Password = &hashedPassword
			}
		}
	}

	// Set Time Offset
	if rUserSettings.TimeOffset != nil {
		templateVars["TimeOffsetMessage"] = "Time Offset Updated"
		newUserSettings.TimeOffset = rUserSettings.TimeOffset
	}

	// Update User
	_, err := api.db.Queries.UpdateUser(api.db.Ctx, newUserSettings)
	if err != nil {
		log.Error("UpdateUser DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpdateUser DB Error: %v", err))
		return
	}

	// Get User
	user, err := api.db.Queries.GetUser(api.db.Ctx, auth.UserName)
	if err != nil {
		log.Error("GetUser DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUser DB Error: %v", err))
		return
	}

	// Get Devices
	devices, err := api.db.Queries.GetDevices(api.db.Ctx, auth.UserName)
	if err != nil {
		log.Error("GetDevices DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDevices DB Error: %v", err))
		return
	}

	templateVars["Data"] = gin.H{
		"TimeOffset": *user.TimeOffset,
		"Devices":    devices,
	}

	c.HTML(http.StatusOK, "page/settings", templateVars)
}

func (api *API) appDemoModeError(c *gin.Context) {
	appErrorPage(c, http.StatusUnauthorized, "Not Allowed in Demo Mode")
}

func (api *API) getDocumentsWordCount(documents []database.GetDocumentsWithStatsRow) error {
	// Do Transaction
	tx, err := api.db.DB.Begin()
	if err != nil {
		log.Error("Transaction Begin DB Error: ", err)
		return err
	}

	// Defer & Start Transaction
	defer tx.Rollback()
	qtx := api.db.Queries.WithTx(tx)

	for _, item := range documents {
		if item.Words == nil && item.Filepath != nil {
			filePath := filepath.Join(api.cfg.DataPath, "documents", *item.Filepath)
			wordCount, err := metadata.GetWordCount(filePath)
			if err != nil {
				log.Warn("Word Count Error: ", err)
			} else {
				if _, err := qtx.UpsertDocument(api.db.Ctx, database.UpsertDocumentParams{
					ID:    item.ID,
					Words: &wordCount,
				}); err != nil {
					log.Error("UpsertDocument DB Error: ", err)
					return err
				}
			}
		}
	}

	// Commit Transaction
	if err := tx.Commit(); err != nil {
		log.Error("Transaction Commit DB Error: ", err)
		return err
	}

	return nil
}

func (api *API) getBaseTemplateVars(routeName string, c *gin.Context) (gin.H, authData) {
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	return gin.H{
		"Authorization": auth,
		"RouteName":     routeName,
		"Config": gin.H{
			"Version":             api.cfg.Version,
			"SearchEnabled":       api.cfg.SearchEnabled,
			"RegistrationEnabled": api.cfg.RegistrationEnabled,
		},
	}, auth
}

func bindQueryParams(c *gin.Context, defaultLimit int64) queryParams {
	var qParams queryParams
	c.BindQuery(&qParams)

	if qParams.Limit == nil {
		qParams.Limit = &defaultLimit
	} else if *qParams.Limit < 0 {
		var zeroValue int64 = 0
		qParams.Limit = &zeroValue
	}

	if qParams.Page == nil || *qParams.Page < 1 {
		var oneValue int64 = 1
		qParams.Page = &oneValue
	}

	return qParams
}

func appErrorPage(c *gin.Context, errorCode int, errorMessage string) {
	var errorHuman string = "We're not even sure what happened."

	switch errorCode {
	case http.StatusInternalServerError:
		errorHuman = "Server hiccup."
	case http.StatusNotFound:
		errorHuman = "Something's missing."
	case http.StatusBadRequest:
		errorHuman = "We didn't expect that."
	case http.StatusUnauthorized:
		errorHuman = "You're not allowed to do that."
	}

	c.HTML(errorCode, "page/error", gin.H{
		"Status":  errorCode,
		"Error":   errorHuman,
		"Message": errorMessage,
	})
}

func arrangeUserStatistics(userStatistics []database.GetUserStatisticsRow) gin.H {
	// Item Sorter
	sortItem := func(userStatistics []database.GetUserStatisticsRow, key string, less func(i int, j int) bool) []map[string]interface{} {
		sortedData := append([]database.GetUserStatisticsRow(nil), userStatistics...)
		sort.SliceStable(sortedData, less)

		newData := make([]map[string]interface{}, 0)
		for _, item := range sortedData {
			v := reflect.Indirect(reflect.ValueOf(item))

			var value string
			if strings.Contains(key, "Wpm") {
				rawVal := v.FieldByName(key).Float()
				value = fmt.Sprintf("%.2f WPM", rawVal)
			} else if strings.Contains(key, "Seconds") {
				rawVal := v.FieldByName(key).Int()
				value = niceSeconds(rawVal)
			} else if strings.Contains(key, "Words") {
				rawVal := v.FieldByName(key).Int()
				value = niceNumbers(rawVal)
			}

			newData = append(newData, map[string]interface{}{
				"UserID": item.UserID,
				"Value":  value,
			})
		}

		return newData
	}

	return gin.H{
		"WPM": gin.H{
			"All": sortItem(userStatistics, "TotalWpm", func(i, j int) bool {
				return userStatistics[i].TotalWpm > userStatistics[j].TotalWpm
			}),
			"Year": sortItem(userStatistics, "YearlyWpm", func(i, j int) bool {
				return userStatistics[i].YearlyWpm > userStatistics[j].YearlyWpm
			}),
			"Month": sortItem(userStatistics, "MonthlyWpm", func(i, j int) bool {
				return userStatistics[i].MonthlyWpm > userStatistics[j].MonthlyWpm
			}),
			"Week": sortItem(userStatistics, "WeeklyWpm", func(i, j int) bool {
				return userStatistics[i].WeeklyWpm > userStatistics[j].WeeklyWpm
			}),
		},
		"Duration": gin.H{
			"All": sortItem(userStatistics, "TotalSeconds", func(i, j int) bool {
				return userStatistics[i].TotalSeconds > userStatistics[j].TotalSeconds
			}),
			"Year": sortItem(userStatistics, "YearlySeconds", func(i, j int) bool {
				return userStatistics[i].YearlySeconds > userStatistics[j].YearlySeconds
			}),
			"Month": sortItem(userStatistics, "MonthlySeconds", func(i, j int) bool {
				return userStatistics[i].MonthlySeconds > userStatistics[j].MonthlySeconds
			}),
			"Week": sortItem(userStatistics, "WeeklySeconds", func(i, j int) bool {
				return userStatistics[i].WeeklySeconds > userStatistics[j].WeeklySeconds
			}),
		},
		"Words": gin.H{
			"All": sortItem(userStatistics, "TotalWordsRead", func(i, j int) bool {
				return userStatistics[i].TotalWordsRead > userStatistics[j].TotalWordsRead
			}),
			"Year": sortItem(userStatistics, "YearlyWordsRead", func(i, j int) bool {
				return userStatistics[i].YearlyWordsRead > userStatistics[j].YearlyWordsRead
			}),
			"Month": sortItem(userStatistics, "MonthlyWordsRead", func(i, j int) bool {
				return userStatistics[i].MonthlyWordsRead > userStatistics[j].MonthlyWordsRead
			}),
			"Week": sortItem(userStatistics, "WeeklyWordsRead", func(i, j int) bool {
				return userStatistics[i].WeeklyWordsRead > userStatistics[j].WeeklyWordsRead
			}),
		},
	}
}

func (api *API) processRestoreFile(rAdminAction requestAdminAction, c *gin.Context) {
	// Validate Type & Derive Extension on MIME
	uploadedFile, err := rAdminAction.RestoreFile.Open()
	if err != nil {
		log.Error("File Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to open file.")
		return
	}

	fileMime, err := mimetype.DetectReader(uploadedFile)
	if err != nil {
		log.Error("MIME Error")
		appErrorPage(c, http.StatusInternalServerError, "Unable to detect filetype.")
		return
	}
	fileExtension := fileMime.Extension()

	// Validate Extension
	if !slices.Contains([]string{".zip"}, fileExtension) {
		log.Error("Invalid FileType: ", fileExtension)
		appErrorPage(c, http.StatusBadRequest, "Invalid filetype.")
		return
	}

	// Create Temp File
	tempFile, err := os.CreateTemp("", "restore")
	if err != nil {
		log.Warn("Temp File Create Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to create temp file.")
		return
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Save Temp
	err = c.SaveUploadedFile(rAdminAction.RestoreFile, tempFile.Name())
	if err != nil {
		log.Error("File Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}

	// ZIP Info
	fileInfo, err := tempFile.Stat()
	if err != nil {
		log.Error("File Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to read file.")
		return
	}

	// Create ZIP Reader
	zipReader, err := zip.NewReader(tempFile, fileInfo.Size())
	if err != nil {
		log.Error("ZIP Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to read zip.")
		return
	}

	// Validate ZIP Contents
	hasDBFile := false
	hasUnknownFile := false
	for _, file := range zipReader.File {
		fileName := strings.TrimPrefix(file.Name, "/")
		if fileName == "antholume.db" {
			hasDBFile = true
			break
		} else if !strings.HasPrefix(fileName, "covers/") && !strings.HasPrefix(fileName, "documents/") {
			hasUnknownFile = true
			break
		}
	}

	// Invalid ZIP
	if !hasDBFile {
		log.Error("Invalid ZIP File - Missing DB")
		appErrorPage(c, http.StatusInternalServerError, "Invalid Restore ZIP - Missing DB")
		return
	} else if hasUnknownFile {
		log.Error("Invalid ZIP File - Invalid File(s)")
		appErrorPage(c, http.StatusInternalServerError, "Invalid Restore ZIP - Invalid File(s)")
		return
	}

	// Create Backup File
	backupFilePath := filepath.Join(api.cfg.ConfigPath, fmt.Sprintf("backups/AnthoLumeBackup_%s.zip", time.Now().Format("20060102150405")))
	backupFile, err := os.Create(backupFilePath)
	if err != nil {
		log.Error("Unable to create backup file: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to create backup file.")
		return
	}
	defer backupFile.Close()

	// Vacuum DB
	_, err = api.db.DB.ExecContext(api.db.Ctx, "VACUUM;")
	if err != nil {
		log.Error("Unable to vacuum DB: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to vacuum database.")
		return
	}

	// Save Backup File
	w := bufio.NewWriter(backupFile)
	err = api.createBackup(w, []string{"covers", "documents"})
	if err != nil {
		log.Error("Unable to save backup file: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to save backup file.")
		return
	}

	// Remove Data
	err = api.removeData()
	if err != nil {
		log.Error("Unable to delete data: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to delete data.")
		return
	}

	// Restore Data
	err = api.restoreData(zipReader)
	if err != nil {
		appErrorPage(c, http.StatusInternalServerError, "Unable to restore data.")
		log.Panic("Unable to restore data: ", err)
		return
	}

	// Reinit DB
	if err := api.db.Reload(); err != nil {
		log.Panicf("Unable to reload DB: %v", err)
	}

	// Rotate Auth Hashes
	if err := api.rotateAllAuthHashes(); err != nil {
		log.Panicf("Unable to rotate auth hashes: %v", err)
	}
}

func (api *API) restoreData(zipReader *zip.Reader) error {
	// Ensure Directories
	api.cfg.EnsureDirectories()

	// Restore Data
	for _, file := range zipReader.File {
		rc, err := file.Open()
		if err != nil {
			return err
		}
		defer rc.Close()

		destPath := filepath.Join(api.cfg.DataPath, file.Name)
		destFile, err := os.Create(destPath)
		if err != nil {
			fmt.Println("Error creating destination file:", err)
			return err
		}
		defer destFile.Close()

		// Copy the contents from the zip file to the destination file.
		if _, err := io.Copy(destFile, rc); err != nil {
			fmt.Println("Error copying file contents:", err)
			return err
		}

		fmt.Printf("Extracted: %s\n", destPath)
	}

	return nil
}

func (api *API) removeData() error {
	allPaths := []string{
		"covers",
		"documents",
		"antholume.db",
		"antholume.db-wal",
		"antholume.db-shm",
	}

	for _, name := range allPaths {
		fullPath := filepath.Join(api.cfg.DataPath, name)
		err := os.RemoveAll(fullPath)
		if err != nil {
			log.Errorf("Unable to delete %s: %v", name, err)
			return err
		}

	}

	return nil
}

func (api *API) createBackup(w io.Writer, directories []string) error {
	ar := zip.NewWriter(w)

	exportWalker := func(currentPath string, f fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if f.IsDir() {
			return nil
		}

		// Open File on Disk
		file, err := os.Open(currentPath)
		if err != nil {
			return err
		}
		defer file.Close()

		// Derive Export Structure
		fileName := filepath.Base(currentPath)
		folderName := filepath.Base(filepath.Dir(currentPath))

		// Create File in Export
		newF, err := ar.Create(filepath.Join(folderName, fileName))
		if err != nil {
			return err
		}

		// Copy File in Export
		_, err = io.Copy(newF, file)
		if err != nil {
			return err
		}

		return nil
	}

	// Get DB Path
	fileName := fmt.Sprintf("%s.db", api.cfg.DBName)
	dbLocation := filepath.Join(api.cfg.ConfigPath, fileName)

	// Copy Database File
	dbFile, err := os.Open(dbLocation)
	if err != nil {
		return err
	}
	defer dbFile.Close()

	newDbFile, err := ar.Create(fileName)
	if err != nil {
		return err
	}
	io.Copy(newDbFile, dbFile)

	// Backup Covers & Documents
	for _, dir := range directories {
		err = filepath.WalkDir(filepath.Join(api.cfg.DataPath, dir), exportWalker)
		if err != nil {
			return err
		}
	}

	ar.Close()
	return nil
}
