package api

import (
	"archive/zip"
	"bufio"
	"crypto/md5"
	"database/sql"
	"fmt"
	"io"
	"io/fs"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path"
	"path/filepath"
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
	c.FileFromFS("assets/manifest.json", http.FS(api.Assets))
}

func (api *API) appServiceWorker(c *gin.Context) {
	c.FileFromFS("assets/sw.js", http.FS(api.Assets))
}

func (api *API) appFaviconIcon(c *gin.Context) {
	c.FileFromFS("assets/icons/favicon.ico", http.FS(api.Assets))
}

func (api *API) appLocalDocuments(c *gin.Context) {
	c.FileFromFS("assets/local/index.htm", http.FS(api.Assets))
}

func (api *API) appDocumentReader(c *gin.Context) {
	c.FileFromFS("assets/reader/index.htm", http.FS(api.Assets))
}

func (api *API) appGetDocuments(c *gin.Context) {
	templateVars, auth := api.getBaseTemplateVars("documents", c)
	qParams := bindQueryParams(c, 9)

	var query *string
	if qParams.Search != nil && *qParams.Search != "" {
		search := "%" + *qParams.Search + "%"
		query = &search
	}

	documents, err := api.DB.Queries.GetDocumentsWithStats(api.DB.Ctx, database.GetDocumentsWithStatsParams{
		UserID: auth.UserName,
		Query:  query,
		Offset: (*qParams.Page - 1) * *qParams.Limit,
		Limit:  *qParams.Limit,
	})
	if err != nil {
		log.Error("[appGetDocuments] GetDocumentsWithStats DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentsWithStats DB Error: %v", err))
		return
	}

	length, err := api.DB.Queries.GetDocumentsSize(api.DB.Ctx, query)
	if err != nil {
		log.Error("[appGetDocuments] GetDocumentsSize DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentsSize DB Error: %v", err))
		return
	}

	if err = api.getDocumentsWordCount(documents); err != nil {
		log.Error("[appGetDocuments] Unable to Get Word Counts: ", err)
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
		log.Error("[appGetDocument] Invalid URI Bind")
		errorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	document, err := api.DB.Queries.GetDocumentWithStats(api.DB.Ctx, database.GetDocumentWithStatsParams{
		UserID:     auth.UserName,
		DocumentID: rDocID.DocumentID,
	})
	if err != nil {
		log.Error("[appGetDocument] GetDocumentWithStats DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentsWithStats DB Error: %v", err))
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

	progress, err := api.DB.Queries.GetProgress(api.DB.Ctx, progressFilter)
	if err != nil {
		log.Error("[appGetProgress] GetProgress DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetActivity DB Error: %v", err))
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

	activity, err := api.DB.Queries.GetActivity(api.DB.Ctx, activityFilter)
	if err != nil {
		log.Error("[appGetActivity] GetActivity DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetActivity DB Error: %v", err))
		return
	}

	templateVars["Data"] = activity

	c.HTML(http.StatusOK, "page/activity", templateVars)
}

func (api *API) appGetHome(c *gin.Context) {
	templateVars, auth := api.getBaseTemplateVars("home", c)

	start := time.Now()
	graphData, _ := api.DB.Queries.GetDailyReadStats(api.DB.Ctx, auth.UserName)
	log.Debug("[appGetHome] GetDailyReadStats Performance: ", time.Since(start))

	start = time.Now()
	databaseInfo, _ := api.DB.Queries.GetDatabaseInfo(api.DB.Ctx, auth.UserName)
	log.Debug("[appGetHome] GetDatabaseInfo Performance: ", time.Since(start))

	streaks, _ := api.DB.Queries.GetUserStreaks(api.DB.Ctx, auth.UserName)
	WPMLeaderboard, _ := api.DB.Queries.GetWPMLeaderboard(api.DB.Ctx)

	templateVars["Data"] = gin.H{
		"Streaks":        streaks,
		"GraphData":      graphData,
		"DatabaseInfo":   databaseInfo,
		"WPMLeaderboard": WPMLeaderboard,
	}

	c.HTML(http.StatusOK, "page/home", templateVars)
}

func (api *API) appGetSettings(c *gin.Context) {
	templateVars, auth := api.getBaseTemplateVars("settings", c)

	user, err := api.DB.Queries.GetUser(api.DB.Ctx, auth.UserName)
	if err != nil {
		log.Error("[appGetSettings] GetUser DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUser DB Error: %v", err))
		return
	}

	devices, err := api.DB.Queries.GetDevices(api.DB.Ctx, auth.UserName)
	if err != nil {
		log.Error("[appGetSettings] GetDevices DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDevices DB Error: %v", err))
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
	logPath := path.Join(api.Config.ConfigPath, "logs/antholume.log")
	logFile, err := os.Open(logPath)
	if err != nil {
		errorPage(c, http.StatusBadRequest, "Missing AnthoLume log file.")
		return
	}
	defer logFile.Close()

	// Log Lines
	var logLines []string
	scanner := bufio.NewScanner(logFile)
	for scanner.Scan() {
		logLines = append(logLines, scanner.Text())
	}
	templateVars["Data"] = logLines

	c.HTML(http.StatusOK, "page/admin-logs", templateVars)
}

func (api *API) appGetAdminUsers(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin-users", c)

	users, err := api.DB.Queries.GetUsers(api.DB.Ctx)
	if err != nil {
		log.Error("[appGetAdminUsers] GetUsers DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUsers DB Error: %v", err))
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
		log.Error("[appPerformAdminAction] Invalid Form Bind")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	switch rAdminAction.Action {
	case adminImport:
		// TODO
	case adminCacheTables:
		go api.DB.CacheTempTables()
	case adminMetadataMatch:
		// TODO
		// 1. Documents xref most recent metadata table?
		// 2. Select all / deselect?
	case adminRestore:
		// TODO
		// 1. Consume backup ZIP
		// 2. Move existing to "backup" folder (db, wal, shm, covers, documents)
		// 3. Extract backup zip
		// 4. Restart server?
	case adminBackup:
		// Get File Paths
		fileName := fmt.Sprintf("%s.db", api.Config.DBName)
		dbLocation := path.Join(api.Config.ConfigPath, fileName)

		c.Header("Content-type", "application/octet-stream")
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"AnthoLumeExport_%s.zip\"", time.Now().Format("20060102")))

		// Stream Backup ZIP Archive
		c.Stream(func(w io.Writer) bool {
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
				newF, err := ar.Create(path.Join(folderName, fileName))
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

			// Copy Database File
			dbFile, _ := os.Open(dbLocation)
			newDbFile, _ := ar.Create(fileName)
			io.Copy(newDbFile, dbFile)

			// Backup Covers & Documents
			for _, item := range rAdminAction.BackupTypes {
				if item == backupCovers {
					filepath.WalkDir(path.Join(api.Config.DataPath, "covers"), exportWalker)

				} else if item == backupDocuments {
					filepath.WalkDir(path.Join(api.Config.DataPath, "documents"), exportWalker)
				}
			}

			ar.Close()
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
			errorPage(c, http.StatusInternalServerError, fmt.Sprintf("Search Error: %v", err))
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
	templateVars["RegistrationEnabled"] = api.Config.RegistrationEnabled
	c.HTML(http.StatusOK, "page/login", templateVars)
}

func (api *API) appGetRegister(c *gin.Context) {
	if !api.Config.RegistrationEnabled {
		c.Redirect(http.StatusFound, "/login")
		return
	}

	templateVars, _ := api.getBaseTemplateVars("login", c)
	templateVars["RegistrationEnabled"] = api.Config.RegistrationEnabled
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
		log.Error("[appGetDocumentProgress] Invalid URI Bind")
		errorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	progress, err := api.DB.Queries.GetDocumentProgress(api.DB.Ctx, database.GetDocumentProgressParams{
		DocumentID: rDoc.DocumentID,
		UserID:     auth.UserName,
	})

	if err != nil && err != sql.ErrNoRows {
		log.Error("[appGetDocumentProgress] UpsertDocument DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpsertDocument DB Error: %v", err))
		return
	}

	document, err := api.DB.Queries.GetDocumentWithStats(api.DB.Ctx, database.GetDocumentWithStatsParams{
		UserID:     auth.UserName,
		DocumentID: rDoc.DocumentID,
	})
	if err != nil {
		log.Error("[appGetDocumentProgress] GetDocumentWithStats DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentWithStats DB Error: %v", err))
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

	devices, err := api.DB.Queries.GetDevices(api.DB.Ctx, auth.UserName)

	if err != nil && err != sql.ErrNoRows {
		log.Error("[appGetDevices] GetDevices DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDevices DB Error: %v", err))
		return
	}

	c.JSON(http.StatusOK, devices)
}

func (api *API) appUploadNewDocument(c *gin.Context) {
	var rDocUpload requestDocumentUpload
	if err := c.ShouldBind(&rDocUpload); err != nil {
		log.Error("[appUploadNewDocument] Invalid Form Bind")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	if rDocUpload.DocumentFile == nil {
		c.Redirect(http.StatusFound, "./documents")
		return
	}

	// Validate Type & Derive Extension on MIME
	uploadedFile, err := rDocUpload.DocumentFile.Open()
	if err != nil {
		log.Error("[appUploadNewDocument] File Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to open file.")
		return
	}

	fileMime, err := mimetype.DetectReader(uploadedFile)
	if err != nil {
		log.Error("[appUploadNewDocument] MIME Error")
		errorPage(c, http.StatusInternalServerError, "Unable to detect filetype.")
		return
	}
	fileExtension := fileMime.Extension()

	// Validate Extension
	if !slices.Contains([]string{".epub"}, fileExtension) {
		log.Error("[appUploadNewDocument] Invalid FileType: ", fileExtension)
		errorPage(c, http.StatusBadRequest, "Invalid filetype.")
		return
	}

	// Create Temp File
	tempFile, err := os.CreateTemp("", "book")
	if err != nil {
		log.Warn("[appUploadNewDocument] Temp File Create Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to create temp file.")
		return
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Save Temp
	err = c.SaveUploadedFile(rDocUpload.DocumentFile, tempFile.Name())
	if err != nil {
		log.Error("[appUploadNewDocument] File Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}

	// Get Metadata
	metadataInfo, err := metadata.GetMetadata(tempFile.Name())
	if err != nil {
		log.Warn("[appUploadNewDocument] GetMetadata Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to acquire file metadata.")
		return
	}

	// Calculate Partial MD5 ID
	partialMD5, err := utils.CalculatePartialMD5(tempFile.Name())
	if err != nil {
		log.Warn("[appUploadNewDocument] Partial MD5 Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to calculate partial MD5.")
		return
	}

	// Check Exists
	_, err = api.DB.Queries.GetDocument(api.DB.Ctx, partialMD5)
	if err == nil {
		c.Redirect(http.StatusFound, fmt.Sprintf("./documents/%s", partialMD5))
		return
	}

	// Calculate Actual MD5
	fileHash, err := getFileMD5(tempFile.Name())
	if err != nil {
		log.Error("[appUploadNewDocument] MD5 Hash Failure: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to calculate MD5.")
		return
	}

	// Get Word Count
	wordCount, err := metadata.GetWordCount(tempFile.Name())
	if err != nil {
		log.Error("[appUploadNewDocument] Word Count Failure: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to calculate word count.")
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
	safePath := filepath.Join(api.Config.DataPath, "documents", fileName)
	destFile, err := os.Create(safePath)
	if err != nil {
		log.Error("[appUploadNewDocument] Dest File Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}
	defer destFile.Close()

	// Copy File
	if _, err = io.Copy(destFile, tempFile); err != nil {
		log.Error("[appUploadNewDocument] Copy Temp File Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}

	// Upsert Document
	if _, err = api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
		ID:          partialMD5,
		Title:       metadataInfo.Title,
		Author:      metadataInfo.Author,
		Description: metadataInfo.Description,
		Words:       &wordCount,
		Md5:         fileHash,
		Filepath:    &fileName,
	}); err != nil {
		log.Error("[appUploadNewDocument] UpsertDocument DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpsertDocument DB Error: %v", err))
		return
	}

	c.Redirect(http.StatusFound, fmt.Sprintf("./documents/%s", partialMD5))
}

func (api *API) appEditDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("[appEditDocument] Invalid URI Bind")
		errorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	var rDocEdit requestDocumentEdit
	if err := c.ShouldBind(&rDocEdit); err != nil {
		log.Error("[appEditDocument] Invalid Form Bind")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
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
		log.Error("[appEditDocument] Missing Form Values")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
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
			log.Error("[appEditDocument] File Error")
			errorPage(c, http.StatusInternalServerError, "Unable to open file.")
			return
		}

		fileMime, err := mimetype.DetectReader(uploadedFile)
		if err != nil {
			log.Error("[appEditDocument] MIME Error")
			errorPage(c, http.StatusInternalServerError, "Unable to detect filetype.")
			return
		}
		fileExtension := fileMime.Extension()

		// Validate Extension
		if !slices.Contains([]string{".jpg", ".png"}, fileExtension) {
			log.Error("[appEditDocument] Invalid FileType: ", fileExtension)
			errorPage(c, http.StatusBadRequest, "Invalid filetype.")
			return
		}

		// Generate Storage Path
		fileName := fmt.Sprintf("%s%s", rDocID.DocumentID, fileExtension)
		safePath := filepath.Join(api.Config.DataPath, "covers", fileName)

		// Save
		err = c.SaveUploadedFile(rDocEdit.CoverFile, safePath)
		if err != nil {
			log.Error("[appEditDocument] File Error: ", err)
			errorPage(c, http.StatusInternalServerError, "Unable to save file.")
			return
		}

		coverFileName = &fileName
	} else if rDocEdit.CoverGBID != nil {
		var coverDir string = filepath.Join(api.Config.DataPath, "covers")
		fileName, err := metadata.CacheCover(*rDocEdit.CoverGBID, coverDir, rDocID.DocumentID, true)
		if err == nil {
			coverFileName = fileName
		}
	}

	// Update Document
	if _, err := api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
		ID:          rDocID.DocumentID,
		Title:       api.sanitizeInput(rDocEdit.Title),
		Author:      api.sanitizeInput(rDocEdit.Author),
		Description: api.sanitizeInput(rDocEdit.Description),
		Isbn10:      api.sanitizeInput(rDocEdit.ISBN10),
		Isbn13:      api.sanitizeInput(rDocEdit.ISBN13),
		Coverfile:   coverFileName,
	}); err != nil {
		log.Error("[appEditDocument] UpsertDocument DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpsertDocument DB Error: %v", err))
		return
	}

	c.Redirect(http.StatusFound, "./")
	return
}

func (api *API) appDeleteDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("[appDeleteDocument] Invalid URI Bind")
		errorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}
	changed, err := api.DB.Queries.DeleteDocument(api.DB.Ctx, rDocID.DocumentID)
	if err != nil {
		log.Error("[appDeleteDocument] DeleteDocument DB Error")
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("DeleteDocument DB Error: %v", err))
		return
	}
	if changed == 0 {
		log.Error("[appDeleteDocument] DeleteDocument DB Error")
		errorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	c.Redirect(http.StatusFound, "../")
}

func (api *API) appIdentifyDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("[appIdentifyDocument] Invalid URI Bind")
		errorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	var rDocIdentify requestDocumentIdentify
	if err := c.ShouldBind(&rDocIdentify); err != nil {
		log.Error("[appIdentifyDocument] Invalid Form Bind")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
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
		log.Error("[appIdentifyDocument] Invalid Form")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
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
		if _, err = api.DB.Queries.AddMetadata(api.DB.Ctx, database.AddMetadataParams{
			DocumentID:  rDocID.DocumentID,
			Title:       firstResult.Title,
			Author:      firstResult.Author,
			Description: firstResult.Description,
			Gbid:        firstResult.ID,
			Olid:        nil,
			Isbn10:      firstResult.ISBN10,
			Isbn13:      firstResult.ISBN13,
		}); err != nil {
			log.Error("[appIdentifyDocument] AddMetadata DB Error: ", err)
		}

		templateVars["Metadata"] = firstResult
	} else {
		log.Warn("[appIdentifyDocument] Metadata Error")
		templateVars["MetadataError"] = "No Metadata Found"
	}

	document, err := api.DB.Queries.GetDocumentWithStats(api.DB.Ctx, database.GetDocumentWithStatsParams{
		UserID:     auth.UserName,
		DocumentID: rDocID.DocumentID,
	})
	if err != nil {
		log.Error("[appIdentifyDocument] GetDocumentWithStats DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentWithStats DB Error: %v", err))
		return
	}

	templateVars["Data"] = document
	templateVars["TotalTimeLeftSeconds"] = int64((100.0 - document.Percentage) * float64(document.SecondsPerPercent))

	c.HTML(http.StatusOK, "page/document", templateVars)
}

func (api *API) appSaveNewDocument(c *gin.Context) {
	var rDocAdd requestDocumentAdd
	if err := c.ShouldBind(&rDocAdd); err != nil {
		log.Error("[appSaveNewDocument] Invalid Form Bind")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
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
		log.Warn("[appSaveNewDocument] Temp File Error: ", err)
		sendDownloadMessage("Unable to download file", gin.H{"Error": true})
		return
	}

	// Send Message
	sendDownloadMessage("Calculating partial MD5...", gin.H{"Progress": 60})

	// Calculate Partial MD5 ID
	partialMD5, err := utils.CalculatePartialMD5(tempFilePath)
	if err != nil {
		log.Warn("[appSaveNewDocument] Partial MD5 Error: ", err)
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
		log.Error("[appSaveNewDocument] Source File Error: ", err)
		sendDownloadMessage("Unable to open file", gin.H{"Error": true})
		return
	}
	defer os.Remove(tempFilePath)
	defer sourceFile.Close()

	// Generate Storage Path & Open File
	safePath := filepath.Join(api.Config.DataPath, "documents", fileName)
	destFile, err := os.Create(safePath)
	if err != nil {
		log.Error("[appSaveNewDocument] Dest File Error: ", err)
		sendDownloadMessage("Unable to create file", gin.H{"Error": true})
		return
	}
	defer destFile.Close()

	// Copy File
	if _, err = io.Copy(destFile, sourceFile); err != nil {
		log.Error("[appSaveNewDocument] Copy Temp File Error: ", err)
		sendDownloadMessage("Unable to save file", gin.H{"Error": true})
		return
	}

	// Send Message
	sendDownloadMessage("Calculating MD5...", gin.H{"Progress": 70})

	// Get MD5 Hash
	fileHash, err := getFileMD5(safePath)
	if err != nil {
		log.Error("[appSaveNewDocument] Hash Failure: ", err)
		sendDownloadMessage("Unable to calculate MD5", gin.H{"Error": true})
		return
	}

	// Send Message
	sendDownloadMessage("Calculating word count...", gin.H{"Progress": 80})

	// Get Word Count
	wordCount, err := metadata.GetWordCount(safePath)
	if err != nil {
		log.Error("[appSaveNewDocument] Word Count Failure: ", err)
		sendDownloadMessage("Unable to calculate word count", gin.H{"Error": true})
		return
	}

	// Send Message
	sendDownloadMessage("Saving to database...", gin.H{"Progress": 90})

	// Upsert Document
	if _, err = api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
		ID:       partialMD5,
		Title:    rDocAdd.Title,
		Author:   rDocAdd.Author,
		Md5:      fileHash,
		Filepath: &fileName,
		Words:    &wordCount,
	}); err != nil {
		log.Error("[appSaveNewDocument] UpsertDocument DB Error: ", err)
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
		log.Error("[appEditSettings] Invalid Form Bind")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	// Validate Something Exists
	if rUserSettings.Password == nil && rUserSettings.NewPassword == nil && rUserSettings.TimeOffset == nil {
		log.Error("[appEditSettings] Missing Form Values")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
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
	_, err := api.DB.Queries.UpdateUser(api.DB.Ctx, newUserSettings)
	if err != nil {
		log.Error("[appEditSettings] UpdateUser DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpdateUser DB Error: %v", err))
		return
	}

	// Get User
	user, err := api.DB.Queries.GetUser(api.DB.Ctx, auth.UserName)
	if err != nil {
		log.Error("[appEditSettings] GetUser DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUser DB Error: %v", err))
		return
	}

	// Get Devices
	devices, err := api.DB.Queries.GetDevices(api.DB.Ctx, auth.UserName)
	if err != nil {
		log.Error("[appEditSettings] GetDevices DB Error: ", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDevices DB Error: %v", err))
		return
	}

	templateVars["Data"] = gin.H{
		"TimeOffset": *user.TimeOffset,
		"Devices":    devices,
	}

	c.HTML(http.StatusOK, "page/settings", templateVars)
}

func (api *API) appDemoModeError(c *gin.Context) {
	errorPage(c, http.StatusUnauthorized, "Not Allowed in Demo Mode")
}

func (api *API) getDocumentsWordCount(documents []database.GetDocumentsWithStatsRow) error {
	// Do Transaction
	tx, err := api.DB.DB.Begin()
	if err != nil {
		log.Error("[getDocumentsWordCount] Transaction Begin DB Error: ", err)
		return err
	}

	// Defer & Start Transaction
	defer tx.Rollback()
	qtx := api.DB.Queries.WithTx(tx)

	for _, item := range documents {
		if item.Words == nil && item.Filepath != nil {
			filePath := filepath.Join(api.Config.DataPath, "documents", *item.Filepath)
			wordCount, err := metadata.GetWordCount(filePath)
			if err != nil {
				log.Warn("[getDocumentsWordCount] Word Count Error: ", err)
			} else {
				if _, err := qtx.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
					ID:    item.ID,
					Words: &wordCount,
				}); err != nil {
					log.Error("[getDocumentsWordCount] UpsertDocument DB Error: ", err)
					return err
				}
			}
		}
	}

	// Commit Transaction
	if err := tx.Commit(); err != nil {
		log.Error("[getDocumentsWordCount] Transaction Commit DB Error: ", err)
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
			"Version":             api.Config.Version,
			"SearchEnabled":       api.Config.SearchEnabled,
			"RegistrationEnabled": api.Config.RegistrationEnabled,
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

func errorPage(c *gin.Context, errorCode int, errorMessage string) {
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
