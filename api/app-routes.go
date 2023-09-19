package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"

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

func (api *API) createAppResourcesRoute(routeName string, args ...map[string]any) func(*gin.Context) {
	// Merge Optional Template Data
	var templateVars = gin.H{}
	if len(args) > 0 {
		templateVars = args[0]
	}
	templateVars["RouteName"] = routeName

	return func(c *gin.Context) {
		rUser, _ := c.Get("AuthorizedUser")
		qParams := bindQueryParams(c)
		templateVars["User"] = rUser

		if routeName == "documents" {
			documents, err := api.DB.Queries.GetDocumentsWithStats(api.DB.Ctx, database.GetDocumentsWithStatsParams{
				UserID: rUser.(string),
				Offset: (*qParams.Page - 1) * *qParams.Limit,
				Limit:  *qParams.Limit,
			})
			if err != nil {
				log.Info(err)
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
				return
			}

			templateVars["Data"] = documents
		} else if routeName == "home" {
			weekly_streak, _ := api.DB.Queries.GetUserWindowStreaks(api.DB.Ctx, database.GetUserWindowStreaksParams{
				UserID: rUser.(string),
				Window: "WEEK",
			})

			daily_streak, _ := api.DB.Queries.GetUserWindowStreaks(api.DB.Ctx, database.GetUserWindowStreaksParams{
				UserID: rUser.(string),
				Window: "DAY",
			})

			database_info, _ := api.DB.Queries.GetDatabaseInfo(api.DB.Ctx, rUser.(string))
			read_graph_data, err := api.DB.Queries.GetDailyReadStats(api.DB.Ctx, rUser.(string))
			if err != nil {
				log.Info("HMMMM:", err)
			}

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
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	// Validate Document Exists in DB
	document, err := api.DB.Queries.GetDocument(api.DB.Ctx, rDoc.DocumentID)
	if err != nil {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	// Handle Identified Document
	if document.Olid != nil {
		if *document.Olid == "UNKNOWN" {
			c.Redirect(http.StatusFound, "/assets/no-cover.jpg")
			return
		}

		// Derive Path
		fileName := "." + filepath.Clean(fmt.Sprintf("/%s.jpg", *document.Olid))
		safePath := filepath.Join(api.Config.DataPath, "covers", fileName)

		// Validate File Exists
		_, err = os.Stat(safePath)
		if err != nil {
			c.Redirect(http.StatusFound, "/assets/no-cover.jpg")
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
	var coverFilePath *string

	// Identify Documents & Save Covers
	coverIDs, err := metadata.GetCoverIDs(document.Title, document.Author)
	if err == nil && len(coverIDs) > 0 {
		coverFilePath, err = metadata.DownloadAndSaveCover(coverIDs[0], api.Config.DataPath)
		if err == nil {
			coverID = coverIDs[0]
		}
	}

	// Upsert Document
	if _, err = api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
		ID:   document.ID,
		Olid: &coverID,
	}); err != nil {
		log.Error("Document Upsert Error")
	}

	// Return Unknown Cover
	if coverID == "UNKNOWN" {
		c.Redirect(http.StatusFound, "/assets/no-cover.jpg")
		return
	}

	c.File(*coverFilePath)
}
