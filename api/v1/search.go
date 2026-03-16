package v1

import (
	"context"

	"reichard.io/antholume/search"
	log "github.com/sirupsen/logrus"
)

// GET /search
func (s *Server) GetSearch(ctx context.Context, request GetSearchRequestObject) (GetSearchResponseObject, error) {

	if request.Params.Query == "" {
		return GetSearch400JSONResponse{Code: 400, Message: "Invalid query"}, nil
	}

	query := request.Params.Query
	source := string(request.Params.Source)

	// Validate source
	if source != "LibGen" && source != "Annas Archive" {
		return GetSearch400JSONResponse{Code: 400, Message: "Invalid source"}, nil
	}

	searchResults, err := search.SearchBook(query, search.Source(source))
	if err != nil {
		log.Error("Search Error:", err)
		return GetSearch500JSONResponse{Code: 500, Message: "Search error"}, nil
	}

	apiResults := make([]SearchItem, len(searchResults))
	for i, item := range searchResults {
		apiResults[i] = SearchItem{
			Id:         ptrOf(item.ID),
			Title:      ptrOf(item.Title),
			Author:     ptrOf(item.Author),
			Language:   ptrOf(item.Language),
			Series:     ptrOf(item.Series),
			FileType:   ptrOf(item.FileType),
			FileSize:   ptrOf(item.FileSize),
			UploadDate: ptrOf(item.UploadDate),
		}
	}

	response := SearchResponse{
		Results: apiResults,
		Source:  source,
		Query:   query,
	}

	return GetSearch200JSONResponse(response), nil
}

// POST /search
func (s *Server) PostSearch(ctx context.Context, request PostSearchRequestObject) (PostSearchResponseObject, error) {
	// This endpoint is used by the SSR template to queue a download
	// For the API, we just return success - the actual download happens via /documents POST
	return PostSearch200Response{}, nil
}