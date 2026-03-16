package v1

import (
	"context"

	"reichard.io/antholume/database"
)

// GET /documents
func (s *Server) GetDocuments(ctx context.Context, request GetDocumentsRequestObject) (GetDocumentsResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetDocuments401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	page := int64(1)
	if request.Params.Page != nil {
		page = *request.Params.Page
	}

	limit := int64(9)
	if request.Params.Limit != nil {
		limit = *request.Params.Limit
	}

	search := ""
	if request.Params.Search != nil {
		search = "%" + *request.Params.Search + "%"
	}

	rows, err := s.db.Queries.GetDocumentsWithStats(
		ctx,
		database.GetDocumentsWithStatsParams{
			UserID:  auth.UserName,
			Query:   &search,
			Deleted: ptrOf(false),
			Offset:  (page - 1) * limit,
			Limit:   limit,
		},
	)
	if err != nil {
		return GetDocuments500JSONResponse{Code: 500, Message: err.Error()}, nil
	}

	total := int64(len(rows))
	var nextPage *int64
	var previousPage *int64
	if page*limit < total {
		nextPage = ptrOf(page + 1)
	}
	if page > 1 {
		previousPage = ptrOf(page - 1)
	}

	apiDocuments := make([]Document, len(rows))
	wordCounts := make([]WordCount, 0, len(rows))
	for i, row := range rows {
		apiDocuments[i] = Document{
			Id:     row.ID,
			Title:  *row.Title,
			Author: *row.Author,
			Words:  row.Words,
		}
		if row.Words != nil {
			wordCounts = append(wordCounts, WordCount{
				DocumentId: row.ID,
				Count:      *row.Words,
			})
		}
	}

	response := DocumentsResponse{
		Documents:    apiDocuments,
		Total:        total,
		Page:         page,
		Limit:        limit,
		NextPage:     nextPage,
		PreviousPage: previousPage,
		Search:       request.Params.Search,
		User:         UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
		WordCounts:   wordCounts,
	}
	return GetDocuments200JSONResponse(response), nil
}

// GET /documents/{id}
func (s *Server) GetDocument(ctx context.Context, request GetDocumentRequestObject) (GetDocumentResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetDocument401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	doc, err := s.db.Queries.GetDocument(ctx, request.Id)
	if err != nil {
		return GetDocument404JSONResponse{Code: 404, Message: "Document not found"}, nil
	}

	progressRow, err := s.db.Queries.GetDocumentProgress(ctx, database.GetDocumentProgressParams{
		UserID:     auth.UserName,
		DocumentID: request.Id,
	})
	var progress *Progress
	if err == nil {
		progress = &Progress{
			UserId:     progressRow.UserID,
			DocumentId: progressRow.DocumentID,
			DeviceId:   progressRow.DeviceID,
			Percentage: progressRow.Percentage,
			Progress:   progressRow.Progress,
			CreatedAt:  parseTime(progressRow.CreatedAt),
		}
	}

	apiDoc := Document{
		Id:        doc.ID,
		Title:     *doc.Title,
		Author:    *doc.Author,
		CreatedAt: parseTime(doc.CreatedAt),
		UpdatedAt: parseTime(doc.UpdatedAt),
		Deleted:   doc.Deleted,
		Words:     doc.Words,
	}

	response := DocumentResponse{
		Document: apiDoc,
		User:     UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
		Progress: progress,
	}
	return GetDocument200JSONResponse(response), nil
}
