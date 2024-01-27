package api

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
	"reichard.io/antholume/opds"
)

var mimeMapping map[string]string = map[string]string{
	"epub": "application/epub+zip",
	"azw":  "application/vnd.amazon.mobi8-ebook",
	"mobi": "application/x-mobipocket-ebook",
	"pdf":  "application/pdf",
	"zip":  "application/zip",
	"txt":  "text/plain",
	"rtf":  "application/rtf",
	"htm":  "text/html",
	"html": "text/html",
	"doc":  "application/msword",
	"lit":  "application/x-ms-reader",
}

func (api *API) opdsEntry(c *gin.Context) {
	// Build & Return XML
	mainFeed := &opds.Feed{
		Title:   "AnthoLume OPDS Server",
		Updated: time.Now().UTC(),
		Links: []opds.Link{
			{
				Title:    "Search AnthoLume",
				Rel:      "search",
				TypeLink: "application/opensearchdescription+xml",
				Href:     "/api/opds/search.xml",
			},
		},

		Entries: []opds.Entry{
			{
				Title: "AnthoLume - All Documents",
				Content: &opds.Content{
					Content:     "AnthoLume - All Documents",
					ContentType: "text",
				},
				Links: []opds.Link{
					{
						Href:     "/api/opds/documents",
						TypeLink: "application/atom+xml;type=feed;profile=opds-catalog",
					},
				},
			},
		},
	}

	c.XML(http.StatusOK, mainFeed)
}

func (api *API) opdsDocuments(c *gin.Context) {
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	// Potential URL Parameters (Default Pagination - 100)
	qParams := bindQueryParams(c, 100)

	// Possible Query
	var query *string
	if qParams.Search != nil && *qParams.Search != "" {
		search := "%" + *qParams.Search + "%"
		query = &search
	}

	// Get Documents
	documents, err := api.DB.Queries.GetDocumentsWithStats(api.DB.Ctx, database.GetDocumentsWithStatsParams{
		UserID: auth.UserName,
		Query:  query,
		Offset: (*qParams.Page - 1) * *qParams.Limit,
		Limit:  *qParams.Limit,
	})
	if err != nil {
		log.Error("GetDocumentsWithStats DB Error:", err)
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	// Build OPDS Entries
	var allEntries []opds.Entry
	for _, doc := range documents {
		// Require File
		if doc.Filepath != nil {
			splitFilepath := strings.Split(*doc.Filepath, ".")
			fileType := splitFilepath[len(splitFilepath)-1]

			title := "N/A"
			if doc.Title != nil {
				title = *doc.Title
			}

			author := "N/A"
			if doc.Author != nil {
				author = *doc.Author
			}

			description := "N/A"
			if doc.Description != nil {
				description = *doc.Description
			}

			item := opds.Entry{
				Title: title,
				Author: []opds.Author{
					{
						Name: author,
					},
				},
				Content: &opds.Content{
					Content:     description,
					ContentType: "text",
				},
				Links: []opds.Link{
					{
						Rel:      "http://opds-spec.org/acquisition",
						Href:     fmt.Sprintf("/api/opds/documents/%s/file", doc.ID),
						TypeLink: mimeMapping[fileType],
					},
					{
						Rel:      "http://opds-spec.org/image",
						Href:     fmt.Sprintf("/api/opds/documents/%s/cover", doc.ID),
						TypeLink: "image/jpeg",
					},
				},
			}

			allEntries = append(allEntries, item)
		}
	}

	feedTitle := "All Documents"
	if query != nil {
		feedTitle = "Search Results"
	}

	// Build & Return XML
	searchFeed := &opds.Feed{
		Title:   feedTitle,
		Updated: time.Now().UTC(),
		Entries: allEntries,
	}

	c.XML(http.StatusOK, searchFeed)
}

func (api *API) opdsSearchDescription(c *gin.Context) {
	rawXML := `<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
		       <ShortName>Search AnthoLume</ShortName>
		       <Description>Search AnthoLume</Description>
		       <Url type="application/atom+xml;profile=opds-catalog;kind=acquisition" template="/api/opds/documents?search={searchTerms}"/>
		   </OpenSearchDescription>`
	c.Data(http.StatusOK, "application/xml", []byte(rawXML))
}
