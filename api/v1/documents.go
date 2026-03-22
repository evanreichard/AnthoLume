package v1

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
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
			Deleted:           false,      // Default, should be overridden if available
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

	// Use GetDocumentsWithStats to get document with stats
	docs, err := s.db.Queries.GetDocumentsWithStats(
		ctx,
		database.GetDocumentsWithStatsParams{
			UserID:  auth.UserName,
			ID:      &request.Id,
			Deleted: ptrOf(false),
			Offset:  0,
			Limit:   1,
		},
	)
	if err != nil || len(docs) == 0 {
		return GetDocument404JSONResponse{Code: 404, Message: "Document not found"}, nil
	}

	doc := docs[0]

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

	apiDoc := Document{
		Id:                doc.ID,
		Title:             *doc.Title,
		Author:            *doc.Author,
		Description:       doc.Description,
		Isbn10:            doc.Isbn10,
		Isbn13:            doc.Isbn13,
		Words:             doc.Words,
		Filepath:          doc.Filepath,
		Percentage:        ptrOf(float32(doc.Percentage)),
		TotalTimeSeconds:  ptrOf(doc.TotalTimeSeconds),
		Wpm:               ptrOf(float32(doc.Wpm)),
		SecondsPerPercent: ptrOf(doc.SecondsPerPercent),
		LastRead:          parseInterfaceTime(doc.LastRead),
		CreatedAt:         time.Now(), // Will be overwritten if we had a proper created_at from DB
		UpdatedAt:         time.Now(), // Will be overwritten if we had a proper updated_at from DB
		Deleted:           false,      // Default, should be overridden if available
	}

	response := DocumentResponse{
		Document: apiDoc,
		Progress: progress,
	}
	return GetDocument200JSONResponse(response), nil
}

// POST /documents/{id}
func (s *Server) EditDocument(ctx context.Context, request EditDocumentRequestObject) (EditDocumentResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return EditDocument401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	if request.Body == nil {
		return EditDocument400JSONResponse{Code: 400, Message: "Missing request body"}, nil
	}

	// Validate document exists and get current state
	currentDoc, err := s.db.Queries.GetDocument(ctx, request.Id)
	if err != nil {
		return EditDocument404JSONResponse{Code: 404, Message: "Document not found"}, nil
	}

	// Validate at least one editable field is provided
	if request.Body.Title == nil &&
		request.Body.Author == nil &&
		request.Body.Description == nil &&
		request.Body.Isbn10 == nil &&
		request.Body.Isbn13 == nil &&
		request.Body.CoverGbid == nil {
		return EditDocument400JSONResponse{Code: 400, Message: "No editable fields provided"}, nil
	}

	// Handle cover via Google Books ID
	var coverFileName *string
	if request.Body.CoverGbid != nil {
		coverDir := filepath.Join(s.cfg.DataPath, "covers")
		fileName, err := metadata.CacheCoverWithContext(ctx, *request.Body.CoverGbid, coverDir, request.Id, true)
		if err == nil {
			coverFileName = fileName
		}
	}

	// Update document with provided editable fields only
	_, err = s.db.Queries.UpsertDocument(ctx, database.UpsertDocumentParams{
		ID:          request.Id,
		Title:       request.Body.Title,
		Author:      request.Body.Author,
		Description: request.Body.Description,
		Isbn10:      request.Body.Isbn10,
		Isbn13:      request.Body.Isbn13,
		Coverfile:   coverFileName,
		// Preserve existing values for non-editable fields
		Md5:      currentDoc.Md5,
		Basepath: currentDoc.Basepath,
		Filepath: currentDoc.Filepath,
		Words:    currentDoc.Words,
	})
	if err != nil {
		log.Error("UpsertDocument DB Error:", err)
		return EditDocument500JSONResponse{Code: 500, Message: "Failed to update document"}, nil
	}

	// Use GetDocumentsWithStats to get document with stats for the response
	docs, err := s.db.Queries.GetDocumentsWithStats(
		ctx,
		database.GetDocumentsWithStatsParams{
			UserID:  auth.UserName,
			ID:      &request.Id,
			Deleted: ptrOf(false),
			Offset:  0,
			Limit:   1,
		},
	)
	if err != nil || len(docs) == 0 {
		return EditDocument404JSONResponse{Code: 404, Message: "Document not found"}, nil
	}

	doc := docs[0]

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

	apiDoc := Document{
		Id:                doc.ID,
		Title:             *doc.Title,
		Author:            *doc.Author,
		Description:       doc.Description,
		Isbn10:            doc.Isbn10,
		Isbn13:            doc.Isbn13,
		Words:             doc.Words,
		Filepath:          doc.Filepath,
		Percentage:        ptrOf(float32(doc.Percentage)),
		TotalTimeSeconds:  ptrOf(doc.TotalTimeSeconds),
		Wpm:               ptrOf(float32(doc.Wpm)),
		SecondsPerPercent: ptrOf(doc.SecondsPerPercent),
		LastRead:          parseInterfaceTime(doc.LastRead),
		CreatedAt:         time.Now(),
		UpdatedAt:         time.Now(),
		Deleted:           false,
	}

	response := DocumentResponse{
		Document: apiDoc,
		Progress: progress,
	}
	return EditDocument200JSONResponse(response), nil
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
func parseInterfaceTime(t any) *time.Time {
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

// serveNoCover serves the default no-cover image from assets
func (s *Server) serveNoCover() (fs.File, string, int64, error) {
	// Try to open the no-cover image from assets
	file, err := s.assets.Open("assets/images/no-cover.jpg")
	if err != nil {
		return nil, "", 0, err
	}

	// Get file info
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, "", 0, err
	}

	return file, "image/jpeg", info.Size(), nil
}

// openFileReader opens a file and returns it as an io.ReaderCloser
func openFileReader(path string) (*os.File, error) {
	return os.Open(path)
}

// GET /documents/{id}/cover
func (s *Server) GetDocumentCover(ctx context.Context, request GetDocumentCoverRequestObject) (GetDocumentCoverResponseObject, error) {
	// Authentication is handled by middleware, which also adds auth data to context
	// This endpoint just serves the cover image

	// Validate Document Exists in DB
	document, err := s.db.Queries.GetDocument(ctx, request.Id)
	if err != nil {
		log.Error("GetDocument DB Error:", err)
		return GetDocumentCover404JSONResponse{Code: 404, Message: "Document not found"}, nil
	}

	var coverFile fs.File
	var contentType string
	var contentLength int64
	var needMetadataFetch bool

	// Handle Identified Document
	if document.Coverfile != nil {
		if *document.Coverfile == "UNKNOWN" {
			// Serve no-cover image
			file, ct, size, err := s.serveNoCover()
			if err != nil {
				log.Error("Failed to open no-cover image:", err)
				return GetDocumentCover404JSONResponse{Code: 404, Message: "Cover not found"}, nil
			}
			coverFile = file
			contentType = ct
			contentLength = size
			needMetadataFetch = true
		} else {
			// Derive Path
			coverPath := filepath.Join(s.cfg.DataPath, "covers", *document.Coverfile)

			// Validate File Exists
			fileInfo, err := os.Stat(coverPath)
			if os.IsNotExist(err) {
				log.Error("Cover file should but doesn't exist: ", err)
				// Serve no-cover image
				file, ct, size, err := s.serveNoCover()
				if err != nil {
					log.Error("Failed to open no-cover image:", err)
					return GetDocumentCover404JSONResponse{Code: 404, Message: "Cover not found"}, nil
				}
				coverFile = file
				contentType = ct
				contentLength = size
				needMetadataFetch = true
			} else {
				// Open the cover file
				file, err := openFileReader(coverPath)
				if err != nil {
					log.Error("Failed to open cover file:", err)
					return GetDocumentCover500JSONResponse{Code: 500, Message: "Failed to open cover"}, nil
				}
				coverFile = file
				contentLength = fileInfo.Size()

				// Determine content type based on file extension
				contentType = "image/jpeg"
				if strings.HasSuffix(coverPath, ".png") {
					contentType = "image/png"
				}
			}
		}
	} else {
		needMetadataFetch = true
	}

	// Attempt Metadata fetch if needed
	var cachedCoverFile string = "UNKNOWN"
	var coverDir string = filepath.Join(s.cfg.DataPath, "covers")

	if needMetadataFetch {
		// Create context with timeout for metadata service calls
		metadataCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()

		// Identify Documents & Save Covers
		metadataResults, err := metadata.SearchMetadataWithContext(metadataCtx, metadata.SOURCE_GBOOK, metadata.MetadataInfo{
			Title:  document.Title,
			Author: document.Author,
		})

		if err == nil && len(metadataResults) > 0 && metadataResults[0].ID != nil {
			firstResult := metadataResults[0]

			// Save Cover
			fileName, err := metadata.CacheCoverWithContext(metadataCtx, *firstResult.ID, coverDir, document.ID, false)
			if err == nil {
				cachedCoverFile = *fileName
			}

			// Store First Metadata Result
			if _, err = s.db.Queries.AddMetadata(ctx, database.AddMetadataParams{
				DocumentID:  document.ID,
				Title:       firstResult.Title,
				Author:      firstResult.Author,
				Description: firstResult.Description,
				Gbid:        firstResult.ID,
				Olid:        nil,
				Isbn10:      firstResult.ISBN10,
				Isbn13:      firstResult.ISBN13,
			}); err != nil {
				log.Error("AddMetadata DB Error:", err)
			}
		}

		// Upsert Document
		if _, err = s.db.Queries.UpsertDocument(ctx, database.UpsertDocumentParams{
			ID:        document.ID,
			Coverfile: &cachedCoverFile,
		}); err != nil {
			log.Warn("UpsertDocument DB Error:", err)
		}

		// Update cover file if we got a new cover
		if cachedCoverFile != "UNKNOWN" {
			coverPath := filepath.Join(coverDir, cachedCoverFile)
			fileInfo, err := os.Stat(coverPath)
			if err != nil {
				log.Error("Failed to stat cached cover:", err)
				// Keep the no-cover image
			} else {
				file, err := openFileReader(coverPath)
				if err != nil {
					log.Error("Failed to open cached cover:", err)
					// Keep the no-cover image
				} else {
					_ = coverFile.Close() // Close the previous file
					coverFile = file
					contentLength = fileInfo.Size()

					// Determine content type based on file extension
					contentType = "image/jpeg"
					if strings.HasSuffix(coverPath, ".png") {
						contentType = "image/png"
					}
				}
			}
		}
	}

	return &GetDocumentCover200Response{
		Body:          coverFile,
		ContentLength: contentLength,
		ContentType:   contentType,
	}, nil
}

// POST /documents/{id}/cover
func (s *Server) UploadDocumentCover(ctx context.Context, request UploadDocumentCoverRequestObject) (UploadDocumentCoverResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return UploadDocumentCover401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	if request.Body == nil {
		return UploadDocumentCover400JSONResponse{Code: 400, Message: "Missing request body"}, nil
	}

	// Validate document exists
	_, err := s.db.Queries.GetDocument(ctx, request.Id)
	if err != nil {
		return UploadDocumentCover404JSONResponse{Code: 404, Message: "Document not found"}, nil
	}

	// Read multipart form
	form, err := request.Body.ReadForm(32 << 20) // 32MB max
	if err != nil {
		log.Error("ReadForm error:", err)
		return UploadDocumentCover500JSONResponse{Code: 500, Message: "Failed to read form"}, nil
	}

	// Get file from form
	fileField := form.File["cover_file"]
	if len(fileField) == 0 {
		return UploadDocumentCover400JSONResponse{Code: 400, Message: "No file provided"}, nil
	}

	file := fileField[0]

	// Validate file extension
	if !strings.HasSuffix(strings.ToLower(file.Filename), ".jpg") && !strings.HasSuffix(strings.ToLower(file.Filename), ".png") {
		return UploadDocumentCover400JSONResponse{Code: 400, Message: "Only JPG and PNG files are allowed"}, nil
	}

	// Open file
	f, err := file.Open()
	if err != nil {
		log.Error("Open file error:", err)
		return UploadDocumentCover500JSONResponse{Code: 500, Message: "Failed to open file"}, nil
	}
	defer f.Close()

	// Read file content
	data, err := io.ReadAll(f)
	if err != nil {
		log.Error("Read file error:", err)
		return UploadDocumentCover500JSONResponse{Code: 500, Message: "Failed to read file"}, nil
	}

	// Validate actual content type
	contentType := http.DetectContentType(data)
	allowedTypes := map[string]bool{
		"image/jpeg": true,
		"image/png":  true,
	}
	if !allowedTypes[contentType] {
		return UploadDocumentCover400JSONResponse{
			Code:    400,
			Message: fmt.Sprintf("Invalid file type: %s. Only JPG and PNG files are allowed.", contentType),
		}, nil
	}

	// Derive storage path
	coverDir := filepath.Join(s.cfg.DataPath, "covers")
	fileName := fmt.Sprintf("%s%s", request.Id, strings.ToLower(filepath.Ext(file.Filename)))
	safePath := filepath.Join(coverDir, fileName)

	// Save file
	err = os.WriteFile(safePath, data, 0644)
	if err != nil {
		log.Error("Save file error:", err)
		return UploadDocumentCover500JSONResponse{Code: 500, Message: "Unable to save cover"}, nil
	}

	// Upsert document with new cover
	_, err = s.db.Queries.UpsertDocument(ctx, database.UpsertDocumentParams{
		ID:        request.Id,
		Coverfile: &fileName,
	})
	if err != nil {
		log.Error("UpsertDocument DB error:", err)
		return UploadDocumentCover500JSONResponse{Code: 500, Message: "Failed to save cover"}, nil
	}

	// Use GetDocumentsWithStats to get document with stats for the response
	docs, err := s.db.Queries.GetDocumentsWithStats(
		ctx,
		database.GetDocumentsWithStatsParams{
			UserID:  auth.UserName,
			ID:      &request.Id,
			Deleted: ptrOf(false),
			Offset:  0,
			Limit:   1,
		},
	)
	if err != nil || len(docs) == 0 {
		return UploadDocumentCover404JSONResponse{Code: 404, Message: "Document not found"}, nil
	}

	doc := docs[0]

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

	apiDoc := Document{
		Id:                doc.ID,
		Title:             *doc.Title,
		Author:            *doc.Author,
		Description:       doc.Description,
		Isbn10:            doc.Isbn10,
		Isbn13:            doc.Isbn13,
		Words:             doc.Words,
		Filepath:          doc.Filepath,
		Percentage:        ptrOf(float32(doc.Percentage)),
		TotalTimeSeconds:  ptrOf(doc.TotalTimeSeconds),
		Wpm:               ptrOf(float32(doc.Wpm)),
		SecondsPerPercent: ptrOf(doc.SecondsPerPercent),
		LastRead:          parseInterfaceTime(doc.LastRead),
		CreatedAt:         time.Now(),
		UpdatedAt:         time.Now(),
		Deleted:           false,
	}

	response := DocumentResponse{
		Document: apiDoc,
		Progress: progress,
	}
	return UploadDocumentCover200JSONResponse(response), nil
}

// GET /documents/{id}/file
func (s *Server) GetDocumentFile(ctx context.Context, request GetDocumentFileRequestObject) (GetDocumentFileResponseObject, error) {
	// Authentication is handled by middleware, which also adds auth data to context
	// This endpoint just serves the document file download
	// Get Document
	document, err := s.db.Queries.GetDocument(ctx, request.Id)
	if err != nil {
		log.Error("GetDocument DB Error:", err)
		return GetDocumentFile404JSONResponse{Code: 404, Message: "Document not found"}, nil
	}

	if document.Filepath == nil {
		log.Error("Document Doesn't Have File:", request.Id)
		return GetDocumentFile404JSONResponse{Code: 404, Message: "Document file not found"}, nil
	}

	// Derive Basepath
	basepath := filepath.Join(s.cfg.DataPath, "documents")
	if document.Basepath != nil && *document.Basepath != "" {
		basepath = *document.Basepath
	}

	// Derive Storage Location
	filePath := filepath.Join(basepath, *document.Filepath)

	// Validate File Exists
	fileInfo, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		log.Error("File should but doesn't exist:", err)
		return GetDocumentFile404JSONResponse{Code: 404, Message: "Document file not found"}, nil
	}

	// Open file
	file, err := os.Open(filePath)
	if err != nil {
		log.Error("Failed to open document file:", err)
		return GetDocumentFile500JSONResponse{Code: 500, Message: "Failed to open document"}, nil
	}

	return &GetDocumentFile200Response{
		Body:          file,
		ContentLength: fileInfo.Size(),
		Filename:      filepath.Base(*document.Filepath),
	}, nil
}

// POST /documents
func (s *Server) CreateDocument(ctx context.Context, request CreateDocumentRequestObject) (CreateDocumentResponseObject, error) {
	_, ok := s.getSessionFromContext(ctx)
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

	// Validate actual content type
	contentType := http.DetectContentType(data)
	if contentType != "application/epub+zip" && contentType != "application/zip" {
		return CreateDocument400JSONResponse{
			Code:    400,
			Message: fmt.Sprintf("Invalid file type: %s. Only EPUB files are allowed.", contentType),
		}, nil
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
			Id:          existingDoc.ID,
			Title:       *existingDoc.Title,
			Author:      *existingDoc.Author,
			Description: existingDoc.Description,
			Isbn10:      existingDoc.Isbn10,
			Isbn13:      existingDoc.Isbn13,
			Words:       existingDoc.Words,
			Filepath:    existingDoc.Filepath,
			CreatedAt:   parseTime(existingDoc.CreatedAt),
			UpdatedAt:   parseTime(existingDoc.UpdatedAt),
			Deleted:     existingDoc.Deleted,
		}
		response := DocumentResponse{
			Document: apiDoc,
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
		Id:          doc.ID,
		Title:       *doc.Title,
		Author:      *doc.Author,
		Description: doc.Description,
		Isbn10:      doc.Isbn10,
		Isbn13:      doc.Isbn13,
		Words:       doc.Words,
		Filepath:    doc.Filepath,
		CreatedAt:   parseTime(doc.CreatedAt),
		UpdatedAt:   parseTime(doc.UpdatedAt),
		Deleted:     doc.Deleted,
	}

	response := DocumentResponse{
		Document: apiDoc,
	}

	return CreateDocument200JSONResponse(response), nil
}

// GetDocumentCover200Response is a custom response type that allows setting content type
type GetDocumentCover200Response struct {
	Body          io.Reader
	ContentLength int64
	ContentType   string
}

func (response GetDocumentCover200Response) VisitGetDocumentCoverResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", response.ContentType)
	if response.ContentLength != 0 {
		w.Header().Set("Content-Length", fmt.Sprint(response.ContentLength))
	}
	w.WriteHeader(200)

	if closer, ok := response.Body.(io.Closer); ok {
		defer closer.Close()
	}
	_, err := io.Copy(w, response.Body)
	return err
}

// GetDocumentFile200Response is a custom response type that allows setting filename for download
type GetDocumentFile200Response struct {
	Body          io.Reader
	ContentLength int64
	Filename      string
}

func (response GetDocumentFile200Response) VisitGetDocumentFileResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/octet-stream")
	if response.ContentLength != 0 {
		w.Header().Set("Content-Length", fmt.Sprint(response.ContentLength))
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", response.Filename))
	w.WriteHeader(200)

	if closer, ok := response.Body.(io.Closer); ok {
		defer closer.Close()
	}
	_, err := io.Copy(w, response.Body)
	return err
}
