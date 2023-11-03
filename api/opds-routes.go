package api

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"reichard.io/bbank/database"
	"reichard.io/bbank/opds"
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

func (api *API) opdsDocuments(c *gin.Context) {
	var userID string
	if rUser, _ := c.Get("AuthorizedUser"); rUser != nil {
		userID = rUser.(string)
	}

	// Potential URL Parameters
	qParams := bindQueryParams(c)

	// Get Documents
	documents, err := api.DB.Queries.GetDocumentsWithStats(api.DB.Ctx, database.GetDocumentsWithStatsParams{
		UserID: userID,
		Offset: (*qParams.Page - 1) * *qParams.Limit,
		Limit:  *qParams.Limit,
	})
	if err != nil {
		log.Error("[opdsDocuments] GetDocumentsWithStats DB Error:", err)
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

			item := opds.Entry{
				Title: fmt.Sprintf("[%3d%%] %s", int(doc.Percentage), *doc.Title),
				Author: []opds.Author{
					{
						Name: *doc.Author,
					},
				},
				Content: &opds.Content{
					Content:     *doc.Description,
					ContentType: "text",
				},
				Links: []opds.Link{
					{
						Rel:      "http://opds-spec.org/acquisition",
						Href:     fmt.Sprintf("./documents/%s/file", doc.ID),
						TypeLink: mimeMapping[fileType],
					},
					{
						Rel:      "http://opds-spec.org/image",
						Href:     fmt.Sprintf("./documents/%s/cover", doc.ID),
						TypeLink: "image/jpeg",
					},
				},
			}

			allEntries = append(allEntries, item)
		}
	}

	// Build & Return XML
	searchFeed := &opds.Feed{
		Title:   "All Documents",
		Updated: time.Now().UTC(),
		// TODO
		// Links: []opds.Link{
		// 	{
		// 		Title:    "Search Book Manager",
		// 		Rel:      "search",
		// 		TypeLink: "application/opensearchdescription+xml",
		// 		Href:     "search.xml",
		// 	},
		// },
		Entries: allEntries,
	}

	c.XML(http.StatusOK, searchFeed)
}

func (api *API) opdsSearchDescription(c *gin.Context) {
	rawXML := `<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
		       <ShortName>Search Book Manager</ShortName>
		       <Description>Search Book Manager</Description>
		       <Url type="application/atom+xml;profile=opds-catalog;kind=acquisition" template="./search?query={searchTerms}"/>
		   </OpenSearchDescription>`
	c.Data(http.StatusOK, "application/xml", []byte(rawXML))
}
