package v1

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	log "github.com/sirupsen/logrus"
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
			Id:                row.ID,
			Title:             *row.Title,
			Author:            *row.Author,
			Description:       row.Description,
			Isbn10:            row.Isbn10,
			Isbn13:            row.Isbn13,
			Words:             row.Words,
			Filepath:          row.Filepath,
			Percentage:        ptrOf(float32(row.Percentage)),
			TotalTimeSeconds:  ptrOf(row.TotalTimeSeconds),
			Wpm:               ptrOf(float32(row.Wpm)),
			SecondsPerPercent: ptrOf(row.SecondsPerPercent),
			LastRead:          parseInterfaceTime(row.LastRead),
			CreatedAt:         time.Now(), // Will be overwritten if we had a proper created_at from DB
			UpdatedAt:         time.Now(), // Will be overwritten if we had a proper updated_at from DB
			Deleted:           false,     // Default, should be overridden if available
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
			UserId:     &progressRow.UserID,
			DocumentId: &progressRow.DocumentID,
			DeviceName: &progressRow.DeviceName,
			Percentage: &progressRow.Percentage,
			CreatedAt:  ptrOf(parseTime(progressRow.CreatedAt)),
		}
	}

	var percentage *float32
	if progress != nil && progress.Percentage != nil {
		percentage = ptrOf(float32(*progress.Percentage))
	}

	apiDoc := Document{
		Id:         doc.ID,
		Title:      *doc.Title,
		Author:     *doc.Author,
		Description: doc.Description,
		Isbn10:     doc.Isbn10,
		Isbn13:     doc.Isbn13,
		Words:      doc.Words,
		Filepath:    doc.Filepath,
		CreatedAt:  parseTime(doc.CreatedAt),
		UpdatedAt:   parseTime(doc.UpdatedAt),
		Deleted:    doc.Deleted,
		Percentage: percentage,
	}

	response := DocumentResponse{
		Document: apiDoc,
		User:     UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
		Progress: progress,
	}
	return GetDocument200JSONResponse(response), nil
}

// deriveBaseFileName builds the base filename for a given MetadataInfo object.
func deriveBaseFileName(metadataInfo *metadata.MetadataInfo) string {
	// Derive New FileName
	var newFileName string
	if metadataInfo.Author != nil && *metadataInfo.Author != "" {
		newFileName = newFileName + *metadataInfo.Author
	} else {
		newFileName = newFileName + "Unknown"
	}
	if metadataInfo.Title != nil && *metadataInfo.Title != "" {
		newFileName = newFileName + " - " + *metadataInfo.Title
	} else {
		newFileName = newFileName + " - Unknown"
	}

	// Remove Slashes
	fileName := strings.ReplaceAll(newFileName, "/", "")
	return "." + filepath.Clean(fmt.Sprintf("/%s [%s]%s", fileName, *metadataInfo.PartialMD5, metadataInfo.Type))
}

// parseInterfaceTime converts an interface{} to time.Time for SQLC queries
func parseInterfaceTime(t interface{}) *time.Time {
	if t == nil {
		return nil
	}
	switch v := t.(type) {
	case string:
		parsed, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return nil
		}
		return &parsed
	case time.Time:
		return &v
	default:
		return nil
	}
}

// POST /documents
func (s *Server) CreateDocument(ctx context.Context, request CreateDocumentRequestObject) (CreateDocumentResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return CreateDocument401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	if request.Body == nil {
		return CreateDocument400JSONResponse{Code: 400, Message: "Missing request body"}, nil
	}

	// Read multipart form
	form, err := request.Body.ReadForm(32 << 20) // 32MB max memory
	if err != nil {
		log.Error("ReadForm error:", err)
		return CreateDocument500JSONResponse{Code: 500, Message: "Failed to read form"}, nil
	}

	// Get file from form
	fileField := form.File["document_file"]
	if len(fileField) == 0 {
		return CreateDocument400JSONResponse{Code: 400, Message: "No file provided"}, nil
	}

	file := fileField[0]
	
	// Validate file extension
	if !strings.HasSuffix(strings.ToLower(file.Filename), ".epub") {
		return CreateDocument400JSONResponse{Code: 400, Message: "Only EPUB files are allowed"}, nil
	}

	// Open file
	f, err := file.Open()
	if err != nil {
		log.Error("Open file error:", err)
		return CreateDocument500JSONResponse{Code: 500, Message: "Failed to open file"}, nil
	}
	defer f.Close()

	// Read file content
	data, err := io.ReadAll(f)
	if err != nil {
		log.Error("Read file error:", err)
		return CreateDocument500JSONResponse{Code: 500, Message: "Failed to read file"}, nil
	}

	// Create temp file to get metadata
	tempFile, err := os.CreateTemp("", "book")
	if err != nil {
		log.Error("Temp file create error:", err)
		return CreateDocument500JSONResponse{Code: 500, Message: "Unable to create temp file"}, nil
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Write data to temp file
	if _, err := tempFile.Write(data); err != nil {
		log.Error("Write temp file error:", err)
		return CreateDocument500JSONResponse{Code: 500, Message: "Unable to write temp file"}, nil
	}

	// Get metadata using metadata package
	metadataInfo, err := metadata.GetMetadata(tempFile.Name())
	if err != nil {
		log.Error("GetMetadata error:", err)
		return CreateDocument500JSONResponse{Code: 500, Message: "Unable to acquire metadata"}, nil
	}

	// Check if already exists
	_, err = s.db.Queries.GetDocument(ctx, *metadataInfo.PartialMD5)
	if err == nil {
		// Document already exists
		existingDoc, _ := s.db.Queries.GetDocument(ctx, *metadataInfo.PartialMD5)
		apiDoc := Document{
			Id:         existingDoc.ID,
			Title:      *existingDoc.Title,
			Author:     *existingDoc.Author,
			Description: existingDoc.Description,
			Isbn10:     existingDoc.Isbn10,
			Isbn13:     existingDoc.Isbn13,
			Words:      existingDoc.Words,
			Filepath:    existingDoc.Filepath,
			CreatedAt:  parseTime(existingDoc.CreatedAt),
			UpdatedAt:   parseTime(existingDoc.UpdatedAt),
			Deleted:    existingDoc.Deleted,
		}
		response := DocumentResponse{
			Document: apiDoc,
			User:     UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
		}
		return CreateDocument200JSONResponse(response), nil
	}

	// Derive & sanitize file name
	fileName := deriveBaseFileName(metadataInfo)
	basePath := filepath.Join(s.cfg.DataPath, "documents")
	safePath := filepath.Join(basePath, fileName)

	// Save file to storage
	err = os.WriteFile(safePath, data, 0644)
	if err != nil {
		log.Error("Save file error:", err)
		return CreateDocument500JSONResponse{Code: 500, Message: "Unable to save file"}, nil
	}

	// Upsert document
	doc, err := s.db.Queries.UpsertDocument(ctx, database.UpsertDocumentParams{
		ID:          *metadataInfo.PartialMD5,
		Title:       metadataInfo.Title,
		Author:      metadataInfo.Author,
		Description: metadataInfo.Description,
		Md5:         metadataInfo.MD5,
		Words:       metadataInfo.WordCount,
		Filepath:    &fileName,
		Basepath:    &basePath,
	})
	if err != nil {
		log.Error("UpsertDocument DB error:", err)
		return CreateDocument500JSONResponse{Code: 500, Message: "Failed to save document"}, nil
	}

	apiDoc := Document{
		Id:         doc.ID,
		Title:      *doc.Title,
		Author:     *doc.Author,
		Description: doc.Description,
		Isbn10:     doc.Isbn10,
		Isbn13:     doc.Isbn13,
		Words:      doc.Words,
		Filepath:    doc.Filepath,
		CreatedAt:  parseTime(doc.CreatedAt),
		UpdatedAt:   parseTime(doc.UpdatedAt),
		Deleted:    doc.Deleted,
	}

	response := DocumentResponse{
		Document: apiDoc,
		User:     UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
	}

	return CreateDocument200JSONResponse(response), nil
}
