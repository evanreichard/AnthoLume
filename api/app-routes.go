package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"reichard.io/bbank/database"
	"reichard.io/bbank/metadata"
)

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
			log.Info("GetUserWindowStreaks - WEEK - ", time.Since(start_time))
			start_time = time.Now()

			daily_streak, err := api.DB.Queries.GetUserWindowStreaks(api.DB.Ctx, database.GetUserWindowStreaksParams{
				UserID: rUser.(string),
				Window: "DAY",
			})
			if err != nil {
				log.Warn("[createAppResourcesRoute] GetUserWindowStreaks DB Error:", err)
			}
			log.Info("GetUserWindowStreaks - DAY - ", time.Since(start_time))

			start_time = time.Now()
			database_info, _ := api.DB.Queries.GetDatabaseInfo(api.DB.Ctx, rUser.(string))
			log.Info("GetDatabaseInfo - ", time.Since(start_time))

			start_time = time.Now()
			read_graph_data, _ := api.DB.Queries.GetDailyReadStats(api.DB.Ctx, rUser.(string))
			log.Info("GetDailyReadStats - ", time.Since(start_time))

			templateVars["Data"] = gin.H{
				"DailyStreak":  daily_streak,
				"WeeklyStreak": weekly_streak,
				"DatabaseInfo": database_info,
				"GraphData":    read_graph_data,
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
	if document.Olid != nil {
		if *document.Olid == "UNKNOWN" {
			c.File("./assets/no-cover.jpg")
			return
		}

		// Derive Path
		fileName := "." + filepath.Clean(fmt.Sprintf("/%s.jpg", *document.Olid))
		safePath := filepath.Join(api.Config.DataPath, "covers", fileName)

		// Validate File Exists
		_, err = os.Stat(safePath)
		if err != nil {
			c.File("./assets/no-cover.jpg")
			return
		}

		c.File(safePath)
		return
	}

	/*
		This is a bit convoluted because we want to ensure we set the OLID to
		UNKNOWN if there are any errors. This will ideally prevent us from
		hitting the OpenLibrary API multiple times in the future.
	*/

	var coverID string = "UNKNOWN"
	var coverFilePath string

	// Identify Documents & Save Covers
	bookMetadata := metadata.MetadataInfo{
		Title:  document.Title,
		Author: document.Author,
	}
	err = metadata.GetMetadata(&bookMetadata)
	if err == nil && bookMetadata.GBID != nil {
		// Derive & Sanitize File Name
		fileName := "." + filepath.Clean(fmt.Sprintf("/%s.jpg", *bookMetadata.GBID))

		// Generate Storage Path
		coverFilePath = filepath.Join(api.Config.DataPath, "covers", fileName)

		err := metadata.SaveCover(*bookMetadata.GBID, coverFilePath)
		if err == nil {
			coverID = *bookMetadata.GBID
			log.Info("Title:", *bookMetadata.Title)
			log.Info("Author:", *bookMetadata.Author)
			log.Info("Description:", *bookMetadata.Description)
			log.Info("IDs:", bookMetadata.ISBN)
		}
	}

	// coverIDs, err := metadata.GetCoverOLIDs(document.Title, document.Author)
	// if err == nil && len(coverIDs) > 0 {
	// 	coverFilePath, err = metadata.DownloadAndSaveCover(coverIDs[0], api.Config.DataPath)
	// 	if err == nil {
	// 		coverID = coverIDs[0]
	// 	}
	// }

	// Upsert Document
	if _, err = api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
		ID:   document.ID,
		Olid: &coverID,
	}); err != nil {
		log.Warn("[getDocumentCover] UpsertDocument DB Error:", err)
	}

	// Return Unknown Cover
	if coverID == "UNKNOWN" {
		c.File("./assets/no-cover.jpg")
		return
	}

	c.File(coverFilePath)
}
