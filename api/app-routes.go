package api

import (
	"crypto/md5"
	"fmt"
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
)

type queryParams struct {
	Page     *int64  `form:"page"`
	Limit    *int64  `form:"limit"`
	Document *string `form:"document"`
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

func baseResourceRoute(template string, args ...map[string]any) func(c *gin.Context) {
	variables := gin.H{"RouteName": template}
	if len(args) > 0 {
		variables = args[0]
	}

	return func(c *gin.Context) {
		rUser, _ := c.Get("AuthorizedUser")
		variables["User"] = rUser
		c.HTML(http.StatusOK, template, variables)
	}
}

func (api *API) webManifest(c *gin.Context) {
	c.Header("Content-Type", "application/manifest+json")
	c.File("./assets/manifest.json")
}

func (api *API) createAppResourcesRoute(routeName string, args ...map[string]any) func(*gin.Context) {
	// Merge Optional Template Data
	var templateVarsBase = gin.H{}
	if len(args) > 0 {
		templateVarsBase = args[0]
	}
	templateVarsBase["RouteName"] = routeName

	return func(c *gin.Context) {
		rUser, _ := c.Get("AuthorizedUser")

		// Copy Base & Update
		templateVars := gin.H{}
		for k, v := range templateVarsBase {
			templateVars[k] = v
		}
		templateVars["User"] = rUser

		// Potential URL Parameters
		qParams := bindQueryParams(c)

		if routeName == "documents" {
			documents, err := api.DB.Queries.GetDocumentsWithStats(api.DB.Ctx, database.GetDocumentsWithStatsParams{
				UserID: rUser.(string),
				Offset: (*qParams.Page - 1) * *qParams.Limit,
				Limit:  *qParams.Limit,
			})
			if err != nil {
				log.Error("[createAppResourcesRoute] GetDocumentsWithStats DB Error:", err)
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
				return
			}

			templateVars["Data"] = documents
		} else if routeName == "document" {
			var rDocID requestDocumentID
			if err := c.ShouldBindUri(&rDocID); err != nil {
				log.Error("[createAppResourcesRoute] Invalid URI Bind")
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
				return
			}

			document, err := api.DB.Queries.GetDocumentWithStats(api.DB.Ctx, database.GetDocumentWithStatsParams{
				UserID:     rUser.(string),
				DocumentID: rDocID.DocumentID,
			})
			if err != nil {
				log.Error("[createAppResourcesRoute] GetDocumentWithStats DB Error:", err)
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
				return
			}

			templateVars["RelBase"] = "../"
			templateVars["Data"] = document
		} else if routeName == "activity" {
			activityFilter := database.GetActivityParams{
				UserID: rUser.(string),
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
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
				return
			}

			templateVars["Data"] = activity
		} else if routeName == "home" {
			start_time := time.Now()
			weekly_streak, err := api.DB.Queries.GetUserWindowStreaks(api.DB.Ctx, database.GetUserWindowStreaksParams{
				UserID: rUser.(string),
				Window: "WEEK",
			})
			if err != nil {
				log.Warn("[createAppResourcesRoute] GetUserWindowStreaks DB Error:", err)
			}
			log.Debug("GetUserWindowStreaks - WEEK - ", time.Since(start_time))
			start_time = time.Now()

			daily_streak, err := api.DB.Queries.GetUserWindowStreaks(api.DB.Ctx, database.GetUserWindowStreaksParams{
				UserID: rUser.(string),
				Window: "DAY",
			})
			if err != nil {
				log.Warn("[createAppResourcesRoute] GetUserWindowStreaks DB Error:", err)
			}
			log.Debug("GetUserWindowStreaks - DAY - ", time.Since(start_time))

			start_time = time.Now()
			database_info, _ := api.DB.Queries.GetDatabaseInfo(api.DB.Ctx, rUser.(string))
			log.Debug("GetDatabaseInfo - ", time.Since(start_time))

			start_time = time.Now()
			read_graph_data, _ := api.DB.Queries.GetDailyReadStats(api.DB.Ctx, rUser.(string))
			log.Debug("GetDailyReadStats - ", time.Since(start_time))

			templateVars["Data"] = gin.H{
				"DailyStreak":  daily_streak,
				"WeeklyStreak": weekly_streak,
				"DatabaseInfo": database_info,
				"GraphData":    read_graph_data,
			}
		} else if routeName == "settings" {
			user, err := api.DB.Queries.GetUser(api.DB.Ctx, rUser.(string))
			if err != nil {
				log.Error("[createAppResourcesRoute] GetUser DB Error:", err)
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
				return
			}

			devices, err := api.DB.Queries.GetDevices(api.DB.Ctx, rUser.(string))
			if err != nil {
				log.Error("[createAppResourcesRoute] GetDevices DB Error:", err)
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
				return
			}

			templateVars["Data"] = gin.H{
				"Settings": gin.H{
					"TimeOffset": *user.TimeOffset,
				},
				"Devices": devices,
			}
		} else if routeName == "login" {
			templateVars["RegistrationEnabled"] = api.Config.RegistrationEnabled
		}

		c.HTML(http.StatusOK, routeName, templateVars)
	}
}

func (api *API) getDocumentCover(c *gin.Context) {
	var rDoc requestDocumentID
	if err := c.ShouldBindUri(&rDoc); err != nil {
		log.Error("[getDocumentCover] Invalid URI Bind")
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	// Validate Document Exists in DB
	document, err := api.DB.Queries.GetDocument(api.DB.Ctx, rDoc.DocumentID)
	if err != nil {
		log.Error("[getDocumentCover] GetDocument DB Error:", err)
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	// Handle Identified Document
	if document.Coverfile != nil {
		if *document.Coverfile == "UNKNOWN" {
			c.File("./assets/no-cover.jpg")
			return
		}

		// Derive Path
		safePath := filepath.Join(api.Config.DataPath, "covers", *document.Coverfile)

		// Validate File Exists
		_, err = os.Stat(safePath)
		if err != nil {
			log.Error("[getDocumentCover] File Should But Doesn't Exist:", err)
			c.File("./assets/no-cover.jpg")
			return
		}

		c.File(safePath)
		return
	}

	// --- Attempt Metadata ---

	var coverDir string = filepath.Join(api.Config.DataPath, "covers")
	var coverFile string = "UNKNOWN"

	// Identify Documents & Save Covers
	metadataResults, err := metadata.GetMetadata(metadata.MetadataInfo{
		Title:  document.Title,
		Author: document.Author,
	})

	if err == nil && len(metadataResults) > 0 && metadataResults[0].GBID != nil {
		firstResult := metadataResults[0]

		// Save Cover
		fileName, err := metadata.SaveCover(*firstResult.GBID, coverDir, document.ID, false)
		if err == nil {
			coverFile = *fileName
		}

		// Store First Metadata Result
		if _, err = api.DB.Queries.AddMetadata(api.DB.Ctx, database.AddMetadataParams{
			DocumentID:  document.ID,
			Title:       firstResult.Title,
			Author:      firstResult.Author,
			Description: firstResult.Description,
			Gbid:        firstResult.GBID,
			Olid:        firstResult.OLID,
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
		c.File("./assets/no-cover.jpg")
		return
	}

	coverFilePath := filepath.Join(coverDir, coverFile)
	c.File(coverFilePath)
}

func (api *API) editDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("[createAppResourcesRoute] Invalid URI Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	var rDocEdit requestDocumentEdit
	if err := c.ShouldBind(&rDocEdit); err != nil {
		log.Error("[createAppResourcesRoute] Invalid Form Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
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
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
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
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
			return
		}

		fileMime, err := mimetype.DetectReader(uploadedFile)
		if err != nil {
			log.Error("[createAppResourcesRoute] MIME Error")
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
			return
		}
		fileExtension := fileMime.Extension()

		// Validate Extension
		if !slices.Contains([]string{".jpg", ".png"}, fileExtension) {
			log.Error("[uploadDocumentFile] Invalid FileType: ", fileExtension)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Filetype"})
			return
		}

		// Generate Storage Path
		fileName := fmt.Sprintf("%s%s", rDocID.DocumentID, fileExtension)
		safePath := filepath.Join(api.Config.DataPath, "covers", fileName)

		// Save
		err = c.SaveUploadedFile(rDocEdit.CoverFile, safePath)
		if err != nil {
			log.Error("[createAppResourcesRoute] File Error")
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
			return
		}

		coverFileName = &fileName
	} else if rDocEdit.CoverGBID != nil {
		var coverDir string = filepath.Join(api.Config.DataPath, "covers")
		fileName, err := metadata.SaveCover(*rDocEdit.CoverGBID, coverDir, rDocID.DocumentID, true)
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
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	c.Redirect(http.StatusFound, "./")
	return
}

func (api *API) deleteDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("[deleteDocument] Invalid URI Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}
	changed, err := api.DB.Queries.DeleteDocument(api.DB.Ctx, rDocID.DocumentID)
	if err != nil {
		log.Error("[deleteDocument] DeleteDocument DB Error")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}
	if changed == 0 {
		log.Error("[deleteDocument] DeleteDocument DB Error")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Document"})
		return
	}

	c.Redirect(http.StatusFound, "../")
}

func (api *API) identifyDocument(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("[identifyDocument] Invalid URI Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	var rDocIdentify requestDocumentIdentify
	if err := c.ShouldBind(&rDocIdentify); err != nil {
		log.Error("[identifyDocument] Invalid Form Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
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
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	// Template Variables
	templateVars := gin.H{
		"RelBase": "../../",
	}

	// Get Metadata
	metadataResults, err := metadata.GetMetadata(metadata.MetadataInfo{
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
			Gbid:        firstResult.GBID,
			Olid:        firstResult.OLID,
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
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	templateVars["Data"] = document

	c.HTML(http.StatusOK, "document", templateVars)
}

func (api *API) editSettings(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")

	var rUserSettings requestSettingsEdit
	if err := c.ShouldBind(&rUserSettings); err != nil {
		log.Error("[editSettings] Invalid Form Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	// Validate Something Exists
	if rUserSettings.Password == nil && rUserSettings.NewPassword == nil && rUserSettings.TimeOffset == nil {
		log.Error("[editSettings] Missing Form Values")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
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
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	// Get User
	user, err := api.DB.Queries.GetUser(api.DB.Ctx, rUser.(string))
	if err != nil {
		log.Error("[editSettings] GetUser DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	// Get Devices
	devices, err := api.DB.Queries.GetDevices(api.DB.Ctx, rUser.(string))
	if err != nil {
		log.Error("[editSettings] GetDevices DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	templateVars["Data"] = gin.H{
		"Settings": gin.H{
			"TimeOffset": *user.TimeOffset,
		},
		"Devices": devices,
	}

	c.HTML(http.StatusOK, "settings", templateVars)
}

func bindQueryParams(c *gin.Context) queryParams {
	var qParams queryParams
	c.BindQuery(&qParams)

	if qParams.Limit == nil {
		var defaultValue int64 = 50
		qParams.Limit = &defaultValue
	} else if *qParams.Limit < 0 {
		var zeroValue int64 = 0
		qParams.Limit = &zeroValue
	}

	if qParams.Page == nil || *qParams.Page < 1 {
		var oneValue int64 = 0
		qParams.Page = &oneValue
	}

	return qParams
}
