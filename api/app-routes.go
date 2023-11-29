package api

import (
	"crypto/md5"
	"database/sql"
	"fmt"
	"io"
	"math"
	"mime/multipart"
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
	"reichard.io/bbank/metadata"
	"reichard.io/bbank/search"
	"reichard.io/bbank/utils"
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

func (api *API) webManifest(c *gin.Context) {
	c.Header("Content-Type", "application/manifest+json")
	c.FileFromFS("assets/manifest.json", http.FS(api.Assets))
}

func (api *API) serviceWorker(c *gin.Context) {
	c.FileFromFS("assets/sw.js", http.FS(api.Assets))
}

func (api *API) faviconIcon(c *gin.Context) {
	c.FileFromFS("assets/icons/favicon.ico", http.FS(api.Assets))
}

func (api *API) localDocuments(c *gin.Context) {
	c.FileFromFS("assets/local/index.htm", http.FS(api.Assets))
}

func (api *API) documentReader(c *gin.Context) {
	c.FileFromFS("assets/reader/index.htm", http.FS(api.Assets))
}

func (api *API) createAppResourcesRoute(routeName string, args ...map[string]any) func(*gin.Context) {
	// Merge Optional Template Data
	var templateVarsBase = gin.H{}
	if len(args) > 0 {
		templateVarsBase = args[0]
	}
	templateVarsBase["RouteName"] = routeName
	templateVarsBase["SearchEnabled"] = api.Config.SearchEnabled

	return func(c *gin.Context) {
		var userID string
		if rUser, _ := c.Get("AuthorizedUser"); rUser != nil {
			userID = rUser.(string)
		}

		// Copy Base & Update
		templateVars := gin.H{}
		for k, v := range templateVarsBase {
			templateVars[k] = v
		}
		templateVars["User"] = userID

		if routeName == "documents" {
			qParams := bindQueryParams(c, 9)

			var query *string
			if qParams.Search != nil && *qParams.Search != "" {
				search := "%" + *qParams.Search + "%"
				query = &search
			}

			documents, err := api.DB.Queries.GetDocumentsWithStats(api.DB.Ctx, database.GetDocumentsWithStatsParams{
				UserID: userID,
				Query:  query,
				Offset: (*qParams.Page - 1) * *qParams.Limit,
				Limit:  *qParams.Limit,
			})
			if err != nil {
				log.Error("[createAppResourcesRoute] GetDocumentsWithStats DB Error:", err)
				errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentsWithStats DB Error: %v", err))
				return
			}

			length, err := api.DB.Queries.GetDocumentsSize(api.DB.Ctx, query)
			if err != nil {
				log.Error("[createAppResourcesRoute] GetDocumentsSize DB Error:", err)
				errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentsSize DB Error: %v", err))
				return
			}

			if err = api.getDocumentsWordCount(documents); err != nil {
				log.Error("[createAppResourcesRoute] Unable to Get Word Counts: ", err)
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
		} else if routeName == "document" {
			var rDocID requestDocumentID
			if err := c.ShouldBindUri(&rDocID); err != nil {
				log.Error("[createAppResourcesRoute] Invalid URI Bind")
				errorPage(c, http.StatusNotFound, "Invalid document.")
				return
			}

			document, err := api.DB.Queries.GetDocumentWithStats(api.DB.Ctx, database.GetDocumentWithStatsParams{
				UserID:     userID,
				DocumentID: rDocID.DocumentID,
			})
			if err != nil {
				log.Error("[createAppResourcesRoute] GetDocumentWithStats DB Error:", err)
				errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentsWithStats DB Error: %v", err))
				return
			}

			templateVars["Data"] = document
			templateVars["TotalTimeLeftSeconds"] = int64((100.0 - document.Percentage) * float64(document.SecondsPerPercent))
		} else if routeName == "activity" {
			qParams := bindQueryParams(c, 15)

			activityFilter := database.GetActivityParams{
				UserID: userID,
				Offset: (*qParams.Page - 1) * *qParams.Limit,
				Limit:  *qParams.Limit,
			}

			if qParams.Document != nil {
				activityFilter.DocFilter = true
				activityFilter.DocumentID = *qParams.Document
			}

			activity, err := api.DB.Queries.GetActivity(api.DB.Ctx, activityFilter)
			if err != nil {
				log.Error("[createAppResourcesRoute] GetActivity DB Error:", err)
				errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetActivity DB Error: %v", err))
				return
			}

			templateVars["Data"] = activity
		} else if routeName == "home" {
			start := time.Now()
			read_graph_data, _ := api.DB.Queries.GetDailyReadStats(api.DB.Ctx, userID)
			log.Info("GetDailyReadStats Performance: ", time.Since(start))

			start = time.Now()
			database_info, _ := api.DB.Queries.GetDatabaseInfo(api.DB.Ctx, userID)
			log.Info("GetDatabaseInfo Performance: ", time.Since(start))

			streaks, _ := api.DB.Queries.GetUserStreaks(api.DB.Ctx, userID)
			wpm_leaderboard, _ := api.DB.Queries.GetWPMLeaderboard(api.DB.Ctx)

			templateVars["Data"] = gin.H{
				"Streaks":        streaks,
				"GraphData":      read_graph_data,
				"DatabaseInfo":   database_info,
				"WPMLeaderboard": wpm_leaderboard,
			}
		} else if routeName == "settings" {
			user, err := api.DB.Queries.GetUser(api.DB.Ctx, userID)
			if err != nil {
				log.Error("[createAppResourcesRoute] GetUser DB Error:", err)
				errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUser DB Error: %v", err))
				return
			}

			devices, err := api.DB.Queries.GetDevices(api.DB.Ctx, userID)
			if err != nil {
				log.Error("[createAppResourcesRoute] GetDevices DB Error:", err)
				errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDevices DB Error: %v", err))
				return
			}

			templateVars["Data"] = gin.H{
				"Settings": gin.H{
					"TimeOffset": *user.TimeOffset,
				},
				"Devices": devices,
			}
		} else if routeName == "search" {
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
		} else if routeName == "login" {
			templateVars["RegistrationEnabled"] = api.Config.RegistrationEnabled
		}
		c.HTML(http.StatusOK, "page/"+routeName, templateVars)
	}
}

func (api *API) getDocumentCover(c *gin.Context) {
	var rDoc requestDocumentID
	if err := c.ShouldBindUri(&rDoc); err != nil {
		log.Error("[getDocumentCover] Invalid URI Bind")
		errorPage(c, http.StatusNotFound, "Invalid cover.")
		return
	}

	// Validate Document Exists in DB
	document, err := api.DB.Queries.GetDocument(api.DB.Ctx, rDoc.DocumentID)
	if err != nil {
		log.Error("[getDocumentCover] GetDocument DB Error:", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocument DB Error: %v", err))
		return
	}

	// Handle Identified Document
	if document.Coverfile != nil {
		if *document.Coverfile == "UNKNOWN" {
			c.FileFromFS("assets/images/no-cover.jpg", http.FS(api.Assets))
			return
		}

		// Derive Path
		safePath := filepath.Join(api.Config.DataPath, "covers", *document.Coverfile)

		// Validate File Exists
		_, err = os.Stat(safePath)
		if err != nil {
			log.Error("[getDocumentCover] File Should But Doesn't Exist:", err)
			c.FileFromFS("assets/images/no-cover.jpg", http.FS(api.Assets))
			return
		}

		c.File(safePath)
		return
	}

	// --- Attempt Metadata ---

	var coverDir string = filepath.Join(api.Config.DataPath, "covers")
	var coverFile string = "UNKNOWN"

	// Identify Documents & Save Covers
	metadataResults, err := metadata.SearchMetadata(metadata.GBOOK, metadata.MetadataInfo{
		Title:  document.Title,
		Author: document.Author,
	})

	if err == nil && len(metadataResults) > 0 && metadataResults[0].ID != nil {
		firstResult := metadataResults[0]

		// Save Cover
		fileName, err := metadata.CacheCover(*firstResult.ID, coverDir, document.ID, false)
		if err == nil {
			coverFile = *fileName
		}

		// Store First Metadata Result
		if _, err = api.DB.Queries.AddMetadata(api.DB.Ctx, database.AddMetadataParams{
			DocumentID:  document.ID,
			Title:       firstResult.Title,
			Author:      firstResult.Author,
			Description: firstResult.Description,
			Gbid:        firstResult.ID,
			Olid:        nil,
			Isbn10:      firstResult.ISBN10,
			Isbn13:      firstResult.ISBN13,
		}); err != nil {
			log.Error("[getDocumentCover] AddMetadata DB Error:", err)
		}
	}

	// Upsert Document
	if _, err = api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
		ID:        document.ID,
		Coverfile: &coverFile,
	}); err != nil {
		log.Warn("[getDocumentCover] UpsertDocument DB Error:", err)
	}

	// Return Unknown Cover
	if coverFile == "UNKNOWN" {
		c.FileFromFS("assets/images/no-cover.jpg", http.FS(api.Assets))
		return
	}

	coverFilePath := filepath.Join(coverDir, coverFile)
	c.File(coverFilePath)
}

func (api *API) getDocumentProgress(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rDoc requestDocumentID
	if err := c.ShouldBindUri(&rDoc); err != nil {
		log.Error("[getDocumentProgress] Invalid URI Bind")
		errorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	progress, err := api.DB.Queries.GetProgress(api.DB.Ctx, database.GetProgressParams{
		DocumentID: rDoc.DocumentID,
		UserID:     rUser.(string),
	})

	if err != nil && err != sql.ErrNoRows {
		log.Error("[getDocumentProgress] UpsertDocument DB Error:", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpsertDocument DB Error: %v", err))
		return
	}

	document, err := api.DB.Queries.GetDocumentWithStats(api.DB.Ctx, database.GetDocumentWithStatsParams{
		UserID:     rUser.(string),
		DocumentID: rDoc.DocumentID,
	})
	if err != nil {
		log.Error("[getDocumentProgress] GetDocumentWithStats DB Error:", err)
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

func (api *API) getDevices(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	devices, err := api.DB.Queries.GetDevices(api.DB.Ctx, rUser.(string))

	if err != nil && err != sql.ErrNoRows {
		log.Error("[getDevices] GetDevices DB Error:", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDevices DB Error: %v", err))
		return
	}

	c.JSON(http.StatusOK, devices)
}

func (api *API) uploadNewDocument(c *gin.Context) {
	var rDocUpload requestDocumentUpload
	if err := c.ShouldBind(&rDocUpload); err != nil {
		log.Error("[uploadNewDocument] Invalid Form Bind")
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
		log.Error("[uploadNewDocument] File Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to open file.")
		return
	}

	fileMime, err := mimetype.DetectReader(uploadedFile)
	if err != nil {
		log.Error("[uploadNewDocument] MIME Error")
		errorPage(c, http.StatusInternalServerError, "Unable to detect filetype.")
		return
	}
	fileExtension := fileMime.Extension()

	// Validate Extension
	if !slices.Contains([]string{".epub"}, fileExtension) {
		log.Error("[uploadNewDocument] Invalid FileType: ", fileExtension)
		errorPage(c, http.StatusBadRequest, "Invalid filetype.")
		return
	}

	// Create Temp File
	tempFile, err := os.CreateTemp("", "book")
	if err != nil {
		log.Warn("[uploadNewDocument] Temp File Create Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to create temp file.")
		return
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Save Temp
	err = c.SaveUploadedFile(rDocUpload.DocumentFile, tempFile.Name())
	if err != nil {
		log.Error("[uploadNewDocument] File Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}

	// Get Metadata
	metadataInfo, err := metadata.GetMetadata(tempFile.Name())
	if err != nil {
		log.Warn("[uploadNewDocument] GetMetadata Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to acquire file metadata.")
		return
	}

	// Calculate Partial MD5 ID
	partialMD5, err := utils.CalculatePartialMD5(tempFile.Name())
	if err != nil {
		log.Warn("[uploadNewDocument] Partial MD5 Error: ", err)
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
		log.Error("[uploadNewDocument] MD5 Hash Failure:", err)
		errorPage(c, http.StatusInternalServerError, "Unable to calculate MD5.")
		return
	}

	// Get Word Count
	wordCount, err := metadata.GetWordCount(tempFile.Name())
	if err != nil {
		log.Error("[uploadNewDocument] Word Count Failure:", err)
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
		log.Error("[uploadNewDocument] Dest File Error:", err)
		errorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}
	defer destFile.Close()

	// Copy File
	if _, err = io.Copy(destFile, tempFile); err != nil {
		log.Error("[uploadNewDocument] Copy Temp File Error:", err)
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
		log.Error("[uploadNewDocument] UpsertDocument DB Error:", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpsertDocument DB Error: %v", err))
		return
	}

	c.Redirect(http.StatusFound, fmt.Sprintf("./documents/%s", partialMD5))
}

func (api *API) editDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("[createAppResourcesRoute] Invalid URI Bind")
		errorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	var rDocEdit requestDocumentEdit
	if err := c.ShouldBind(&rDocEdit); err != nil {
		log.Error("[createAppResourcesRoute] Invalid Form Bind")
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
		log.Error("[createAppResourcesRoute] Missing Form Values")
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
			log.Error("[createAppResourcesRoute] File Error")
			errorPage(c, http.StatusInternalServerError, "Unable to open file.")
			return
		}

		fileMime, err := mimetype.DetectReader(uploadedFile)
		if err != nil {
			log.Error("[createAppResourcesRoute] MIME Error")
			errorPage(c, http.StatusInternalServerError, "Unable to detect filetype.")
			return
		}
		fileExtension := fileMime.Extension()

		// Validate Extension
		if !slices.Contains([]string{".jpg", ".png"}, fileExtension) {
			log.Error("[uploadDocumentFile] Invalid FileType: ", fileExtension)
			errorPage(c, http.StatusBadRequest, "Invalid filetype.")
			return
		}

		// Generate Storage Path
		fileName := fmt.Sprintf("%s%s", rDocID.DocumentID, fileExtension)
		safePath := filepath.Join(api.Config.DataPath, "covers", fileName)

		// Save
		err = c.SaveUploadedFile(rDocEdit.CoverFile, safePath)
		if err != nil {
			log.Error("[createAppResourcesRoute] File Error: ", err)
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
		log.Error("[createAppResourcesRoute] UpsertDocument DB Error:", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpsertDocument DB Error: %v", err))
		return
	}

	c.Redirect(http.StatusFound, "./")
	return
}

func (api *API) deleteDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("[deleteDocument] Invalid URI Bind")
		errorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}
	changed, err := api.DB.Queries.DeleteDocument(api.DB.Ctx, rDocID.DocumentID)
	if err != nil {
		log.Error("[deleteDocument] DeleteDocument DB Error")
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("DeleteDocument DB Error: %v", err))
		return
	}
	if changed == 0 {
		log.Error("[deleteDocument] DeleteDocument DB Error")
		errorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	c.Redirect(http.StatusFound, "../")
}

func (api *API) identifyDocument(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("[identifyDocument] Invalid URI Bind")
		errorPage(c, http.StatusNotFound, "Invalid document.")
		return
	}

	var rDocIdentify requestDocumentIdentify
	if err := c.ShouldBind(&rDocIdentify); err != nil {
		log.Error("[identifyDocument] Invalid Form Bind")
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
		log.Error("[identifyDocument] Invalid Form")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	// Template Variables
	templateVars := gin.H{
		"SearchEnabled": api.Config.SearchEnabled,
	}

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
			log.Error("[identifyDocument] AddMetadata DB Error:", err)
		}

		templateVars["Metadata"] = firstResult
	} else {
		log.Warn("[identifyDocument] Metadata Error")
		templateVars["MetadataError"] = "No Metadata Found"
	}

	document, err := api.DB.Queries.GetDocumentWithStats(api.DB.Ctx, database.GetDocumentWithStatsParams{
		UserID:     rUser.(string),
		DocumentID: rDocID.DocumentID,
	})
	if err != nil {
		log.Error("[identifyDocument] GetDocumentWithStats DB Error:", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentWithStats DB Error: %v", err))
		return
	}

	templateVars["Data"] = document
	templateVars["TotalTimeLeftSeconds"] = int64((100.0 - document.Percentage) * float64(document.SecondsPerPercent))

	c.HTML(http.StatusOK, "page/document", templateVars)
}

func (api *API) saveNewDocument(c *gin.Context) {
	var rDocAdd requestDocumentAdd
	if err := c.ShouldBind(&rDocAdd); err != nil {
		log.Error("[saveNewDocument] Invalid Form Bind")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	// Save Book
	tempFilePath, err := search.SaveBook(rDocAdd.ID, rDocAdd.Source)
	if err != nil {
		log.Warn("[saveNewDocument] Temp File Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}

	// Calculate Partial MD5 ID
	partialMD5, err := utils.CalculatePartialMD5(tempFilePath)
	if err != nil {
		log.Warn("[saveNewDocument] Partial MD5 Error: ", err)
		errorPage(c, http.StatusInternalServerError, "Unable to calculate partial MD5.")
		return
	}

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
		log.Error("[saveNewDocument] Source File Error:", err)
		errorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}
	defer os.Remove(tempFilePath)
	defer sourceFile.Close()

	// Generate Storage Path & Open File
	safePath := filepath.Join(api.Config.DataPath, "documents", fileName)
	destFile, err := os.Create(safePath)
	if err != nil {
		log.Error("[saveNewDocument] Dest File Error:", err)
		errorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}
	defer destFile.Close()

	// Copy File
	if _, err = io.Copy(destFile, sourceFile); err != nil {
		log.Error("[saveNewDocument] Copy Temp File Error:", err)
		errorPage(c, http.StatusInternalServerError, "Unable to save file.")
		return
	}

	// Get MD5 Hash
	fileHash, err := getFileMD5(safePath)
	if err != nil {
		log.Error("[saveNewDocument] Hash Failure:", err)
		errorPage(c, http.StatusInternalServerError, "Unable to calculate MD5.")
		return
	}

	// Get Word Count
	wordCount, err := metadata.GetWordCount(safePath)
	if err != nil {
		log.Error("[saveNewDocument] Word Count Failure:", err)
		errorPage(c, http.StatusInternalServerError, "Unable to calculate word count.")
		return
	}

	// Upsert Document
	if _, err = api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
		ID:       partialMD5,
		Title:    rDocAdd.Title,
		Author:   rDocAdd.Author,
		Md5:      fileHash,
		Filepath: &fileName,
		Words:    &wordCount,
	}); err != nil {
		log.Error("[saveNewDocument] UpsertDocument DB Error:", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpsertDocument DB Error: %v", err))
		return
	}

	c.Redirect(http.StatusFound, fmt.Sprintf("./documents/%s", partialMD5))
}

func (api *API) editSettings(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rUserSettings requestSettingsEdit
	if err := c.ShouldBind(&rUserSettings); err != nil {
		log.Error("[editSettings] Invalid Form Bind")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	// Validate Something Exists
	if rUserSettings.Password == nil && rUserSettings.NewPassword == nil && rUserSettings.TimeOffset == nil {
		log.Error("[editSettings] Missing Form Values")
		errorPage(c, http.StatusBadRequest, "Invalid or missing form values.")
		return
	}

	templateVars := gin.H{
		"User": rUser,
	}
	newUserSettings := database.UpdateUserParams{
		UserID: rUser.(string),
	}

	// Set New Password
	if rUserSettings.Password != nil && rUserSettings.NewPassword != nil {
		password := fmt.Sprintf("%x", md5.Sum([]byte(*rUserSettings.Password)))
		authorized := api.authorizeCredentials(rUser.(string), password)
		if authorized == true {
			password := fmt.Sprintf("%x", md5.Sum([]byte(*rUserSettings.NewPassword)))
			hashedPassword, err := argon2.CreateHash(password, argon2.DefaultParams)
			if err != nil {
				templateVars["PasswordErrorMessage"] = "Unknown Error"
			} else {
				templateVars["PasswordMessage"] = "Password Updated"
				newUserSettings.Password = &hashedPassword
			}
		} else {
			templateVars["PasswordErrorMessage"] = "Invalid Password"
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
		log.Error("[editSettings] UpdateUser DB Error:", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpdateUser DB Error: %v", err))
		return
	}

	// Get User
	user, err := api.DB.Queries.GetUser(api.DB.Ctx, rUser.(string))
	if err != nil {
		log.Error("[editSettings] GetUser DB Error:", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUser DB Error: %v", err))
		return
	}

	// Get Devices
	devices, err := api.DB.Queries.GetDevices(api.DB.Ctx, rUser.(string))
	if err != nil {
		log.Error("[editSettings] GetDevices DB Error:", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDevices DB Error: %v", err))
		return
	}

	templateVars["Data"] = gin.H{
		"Settings": gin.H{
			"TimeOffset": *user.TimeOffset,
		},
		"Devices":       devices,
		"SearchEnabled": api.Config.SearchEnabled,
	}

	c.HTML(http.StatusOK, "page/settings", templateVars)
}

func (api *API) getDocumentsWordCount(documents []database.GetDocumentsWithStatsRow) error {
	// Do Transaction
	tx, err := api.DB.DB.Begin()
	if err != nil {
		log.Error("[getDocumentsWordCount] Transaction Begin DB Error:", err)
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
				log.Warn("[getDocumentsWordCount] Word Count Error - ", err)
			} else {
				if _, err := qtx.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
					ID:    item.ID,
					Words: &wordCount,
				}); err != nil {
					log.Error("[getDocumentsWordCount] UpsertDocument DB Error - ", err)
					return err
				}
			}
		}
	}

	// Commit Transaction
	if err := tx.Commit(); err != nil {
		log.Error("[getDocumentsWordCount] Transaction Commit DB Error:", err)
		return err
	}

	return nil
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
