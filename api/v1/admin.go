package v1

import (
	"archive/zip"
	"bufio"
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime/multipart"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	argon2 "github.com/alexedwards/argon2id"
	"github.com/itchyny/gojq"
	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/utils"
)

// GET /admin
func (s *Server) GetAdmin(ctx context.Context, request GetAdminRequestObject) (GetAdminResponseObject, error) {
	_, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetAdmin401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	// Get documents count using existing SQLC query
	documentsSize, err := s.db.Queries.GetDocumentsSize(ctx, nil)
	if err != nil {
		return GetAdmin401JSONResponse{Code: 500, Message: err.Error()}, nil
	}

	// For other counts, we need to aggregate across all users
	// Get all users first
	users, err := s.db.Queries.GetUsers(ctx)
	if err != nil {
		return GetAdmin401JSONResponse{Code: 500, Message: err.Error()}, nil
	}

	var activitySize, progressSize, devicesSize int64
	for _, user := range users {
		// Get user's database info using existing SQLC query
		dbInfo, err := s.db.Queries.GetDatabaseInfo(ctx, user.ID)
		if err == nil {
			activitySize += dbInfo.ActivitySize
			progressSize += dbInfo.ProgressSize
			devicesSize += dbInfo.DevicesSize
		}
	}

	response := GetAdmin200JSONResponse{
		DatabaseInfo: &DatabaseInfo{
			DocumentsSize: documentsSize,
			ActivitySize:  activitySize,
			ProgressSize:  progressSize,
			DevicesSize:   devicesSize,
		},
	}
	return response, nil
}

// POST /admin
func (s *Server) PostAdminAction(ctx context.Context, request PostAdminActionRequestObject) (PostAdminActionResponseObject, error) {
	_, ok := s.getSessionFromContext(ctx)
	if !ok {
		return PostAdminAction401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	if request.Body == nil {
		return PostAdminAction400JSONResponse{Code: 400, Message: "Missing request body"}, nil
	}

	// Read the multipart form in a streaming way to support large files
	reader := request.Body
	form, err := reader.ReadForm(32 << 20) // 32MB for non-file fields (files are not stored in memory)
	if err != nil {
		return PostAdminAction400JSONResponse{Code: 400, Message: "Unable to parse form"}, nil
	}

	// Extract action from form
	actionValues := form.Value["action"]
	if len(actionValues) == 0 {
		return PostAdminAction400JSONResponse{Code: 400, Message: "Missing action"}, nil
	}
	action := actionValues[0]

	// Handle different admin actions mirroring legacy appPerformAdminAction
	switch action {
	case "METADATA_MATCH":
		// This is a TODO in the legacy code as well
		go func() {
			// TODO: Implement metadata matching logic
			log.Info("Metadata match action triggered (not yet implemented)")
		}()
		return PostAdminAction200JSONResponse{
			Message: "Metadata match started",
		}, nil

	case "CACHE_TABLES":
		// Cache temp tables asynchronously, matching legacy implementation
		go func() {
			err := s.db.CacheTempTables(context.Background())
			if err != nil {
				log.Error("Unable to cache temp tables: ", err)
			}
		}()
		return PostAdminAction200JSONResponse{
			Message: "Cache tables operation started",
		}, nil

	case "BACKUP":
		return s.handleBackupAction(ctx, request, form)

	case "RESTORE":
		return s.handleRestoreAction(ctx, request, form)

	default:
		return PostAdminAction400JSONResponse{Code: 400, Message: "Invalid action"}, nil
	}
}

// handleBackupAction handles the backup action, mirroring legacy createBackup logic
func (s *Server) handleBackupAction(ctx context.Context, request PostAdminActionRequestObject, form *multipart.Form) (PostAdminActionResponseObject, error) {
	// Extract backup_types from form
	backupTypesValues := form.Value["backup_types"]

	// Create a pipe for streaming the backup
	pr, pw := io.Pipe()

	go func() {
		defer pw.Close()
		var directories []string
		for _, val := range backupTypesValues {
			if val == "COVERS" {
				directories = append(directories, "covers")
			} else if val == "DOCUMENTS" {
				directories = append(directories, "documents")
			}
		}
		log.Info("Starting backup for directories: ", directories)
		err := s.createBackup(ctx, pw, directories)
		if err != nil {
			log.Error("Backup failed: ", err)
		} else {
			log.Info("Backup completed successfully")
		}
	}()

	// Set Content-Length to 0 to enable chunked transfer encoding
	// This allows streaming with unknown file size
	return PostAdminAction200ApplicationoctetStreamResponse{
		Body:          pr,
		ContentLength: 0,
	}, nil
}

// handleRestoreAction handles the restore action, mirroring legacy processRestoreFile logic
func (s *Server) handleRestoreAction(ctx context.Context, request PostAdminActionRequestObject, form *multipart.Form) (PostAdminActionResponseObject, error) {
	// Get the uploaded file from form
	fileHeaders := form.File["restore_file"]
	if len(fileHeaders) == 0 {
		return PostAdminAction400JSONResponse{Code: 400, Message: "Missing restore file"}, nil
	}

	file, err := fileHeaders[0].Open()
	if err != nil {
		return PostAdminAction400JSONResponse{Code: 400, Message: "Unable to open restore file"}, nil
	}
	defer file.Close()

	// Create temp file for the uploaded file
	tempFile, err := os.CreateTemp("", "restore")
	if err != nil {
		log.Warn("Temp File Create Error: ", err)
		return PostAdminAction500JSONResponse{Code: 500, Message: "Unable to create temp file"}, nil
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Save uploaded file to temp
	if _, err = io.Copy(tempFile, file); err != nil {
		log.Error("Unable to save uploaded file: ", err)
		return PostAdminAction500JSONResponse{Code: 500, Message: "Unable to save file"}, nil
	}

	// Get file info and validate ZIP
	fileInfo, err := tempFile.Stat()
	if err != nil {
		log.Error("Unable to read temp file: ", err)
		return PostAdminAction500JSONResponse{Code: 500, Message: "Unable to read file"}, nil
	}

	zipReader, err := zip.NewReader(tempFile, fileInfo.Size())
	if err != nil {
		log.Error("Unable to read zip: ", err)
		return PostAdminAction500JSONResponse{Code: 500, Message: "Unable to read zip"}, nil
	}

	// Validate ZIP contents (mirroring legacy logic)
	hasDBFile := false
	hasUnknownFile := false
	for _, file := range zipReader.File {
		fileName := strings.TrimPrefix(file.Name, "/")
		if fileName == "antholume.db" {
			hasDBFile = true
		} else if !strings.HasPrefix(fileName, "covers/") && !strings.HasPrefix(fileName, "documents/") {
			hasUnknownFile = true
		}
	}

	if !hasDBFile {
		return PostAdminAction500JSONResponse{Code: 500, Message: "Invalid Restore ZIP - Missing DB"}, nil
	} else if hasUnknownFile {
		return PostAdminAction500JSONResponse{Code: 500, Message: "Invalid Restore ZIP - Invalid File(s)"}, nil
	}

	// Create backup before restoring (mirroring legacy logic)
	log.Info("Creating backup before restore...")
	backupFilePath := filepath.Join(s.cfg.ConfigPath, fmt.Sprintf("backups/AnthoLumeBackup_%s.zip", time.Now().Format("20060102150405")))
	backupFile, err := os.Create(backupFilePath)
	if err != nil {
		log.Error("Unable to create backup file: ", err)
		return PostAdminAction500JSONResponse{Code: 500, Message: "Unable to create backup file"}, nil
	}
	defer backupFile.Close()

	w := bufio.NewWriter(backupFile)
	err = s.createBackup(ctx, w, []string{"covers", "documents"})
	if err != nil {
		log.Error("Unable to save backup file: ", err)
		return PostAdminAction500JSONResponse{Code: 500, Message: "Unable to save backup file"}, nil
	}

	// Remove data (mirroring legacy removeData)
	log.Info("Removing data...")
	err = s.removeData()
	if err != nil {
		log.Error("Unable to delete data: ", err)
		return PostAdminAction500JSONResponse{Code: 500, Message: "Unable to delete data"}, nil
	}

	// Restore data (mirroring legacy restoreData)
	log.Info("Restoring data...")
	err = s.restoreData(zipReader)
	if err != nil {
		log.Error("Unable to restore data: ", err)
		return PostAdminAction500JSONResponse{Code: 500, Message: "Unable to restore data"}, nil
	}

	// Reload DB (mirroring legacy Reload)
	log.Info("Reloading database...")
	if err := s.db.Reload(ctx); err != nil {
		log.Error("Unable to reload DB: ", err)
		return PostAdminAction500JSONResponse{Code: 500, Message: "Unable to reload DB"}, nil
	}

	// Rotate auth hashes (mirroring legacy rotateAllAuthHashes)
	log.Info("Rotating auth hashes...")
	if err := s.rotateAllAuthHashes(ctx); err != nil {
		log.Error("Unable to rotate hashes: ", err)
		return PostAdminAction500JSONResponse{Code: 500, Message: "Unable to rotate hashes"}, nil
	}

	log.Info("Restore completed successfully")
	return PostAdminAction200JSONResponse{
		Message: "Restore completed successfully",
	}, nil
}

// createBackup creates a backup ZIP archive, mirroring legacy createBackup
func (s *Server) createBackup(ctx context.Context, w io.Writer, directories []string) error {
	// Vacuum DB
	_, err := s.db.DB.ExecContext(ctx, "VACUUM;")
	if err != nil {
		return fmt.Errorf("Unable to vacuum database: %w", err)
	}

	ar := zip.NewWriter(w)

	// Helper function to walk and archive files
	exportWalker := func(currentPath string, f fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if f.IsDir() {
			return nil
		}

		file, err := os.Open(currentPath)
		if err != nil {
			return err
		}
		defer file.Close()

		fileName := filepath.Base(currentPath)
		folderName := filepath.Base(filepath.Dir(currentPath))

		newF, err := ar.Create(filepath.Join(folderName, fileName))
		if err != nil {
			return err
		}

		_, err = io.Copy(newF, file)
		return err
	}

	// Copy Database File (mirroring legacy logic)
	fileName := fmt.Sprintf("%s.db", s.cfg.DBName)
	dbLocation := filepath.Join(s.cfg.ConfigPath, fileName)

	dbFile, err := os.Open(dbLocation)
	if err != nil {
		return err
	}
	defer dbFile.Close()

	newDbFile, err := ar.Create(fileName)
	if err != nil {
		return err
	}

	_, err = io.Copy(newDbFile, dbFile)
	if err != nil {
		return err
	}

	// Backup Covers & Documents (mirroring legacy logic)
	for _, dir := range directories {
		err = filepath.WalkDir(filepath.Join(s.cfg.DataPath, dir), exportWalker)
		if err != nil {
			return err
		}
	}

	// Close writer to flush all data before returning
	ar.Close()
	return nil
}

// removeData removes all data files, mirroring legacy removeData
func (s *Server) removeData() error {
	allPaths := []string{
		"covers",
		"documents",
		"antholume.db",
		"antholume.db-wal",
		"antholume.db-shm",
	}

	for _, name := range allPaths {
		fullPath := filepath.Join(s.cfg.DataPath, name)
		err := os.RemoveAll(fullPath)
		if err != nil {
			return err
		}
	}

	return nil
}

// restoreData restores data from ZIP archive, mirroring legacy restoreData
func (s *Server) restoreData(zipReader *zip.Reader) error {
	// Ensure Directories
	s.cfg.EnsureDirectories()

	// Restore Data
	for _, file := range zipReader.File {
		rc, err := file.Open()
		if err != nil {
			return err
		}
		defer rc.Close()

		destPath := filepath.Join(s.cfg.DataPath, file.Name)
		destFile, err := os.Create(destPath)
		if err != nil {
			log.Errorf("error creating destination file: %v", err)
			return err
		}
		defer destFile.Close()

		// Copy the contents from the zip file to the destination file.
		if _, err := io.Copy(destFile, rc); err != nil {
			log.Errorf("Error copying file contents: %v", err)
			return err
		}
	}

	return nil
}

// rotateAllAuthHashes rotates all user auth hashes, mirroring legacy rotateAllAuthHashes
func (s *Server) rotateAllAuthHashes(ctx context.Context) error {
	users, err := s.db.Queries.GetUsers(ctx)
	if err != nil {
		return err
	}

	for _, user := range users {
		rawAuthHash, err := utils.GenerateToken(64)
		if err != nil {
			return err
		}
		authHash := fmt.Sprintf("%x", rawAuthHash)

		_, err = s.db.Queries.UpdateUser(ctx, database.UpdateUserParams{
			UserID:   user.ID,
			AuthHash: &authHash,
			Admin:    user.Admin,
		})
		if err != nil {
			return err
		}
	}

	return nil
}

// GET /admin/users
func (s *Server) GetUsers(ctx context.Context, request GetUsersRequestObject) (GetUsersResponseObject, error) {
	_, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetUsers401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	// Get users from database
	users, err := s.db.Queries.GetUsers(ctx)
	if err != nil {
		return GetUsers500JSONResponse{Code: 500, Message: err.Error()}, nil
	}

	apiUsers := make([]User, len(users))
	for i, user := range users {
		apiUsers[i] = User{
			Id:        user.ID,
			Admin:     user.Admin,
			CreatedAt: parseTime(user.CreatedAt),
		}
	}

	response := GetUsers200JSONResponse{
		Users: &apiUsers,
	}
	return response, nil
}

// POST /admin/users
func (s *Server) UpdateUser(ctx context.Context, request UpdateUserRequestObject) (UpdateUserResponseObject, error) {
	_, ok := s.getSessionFromContext(ctx)
	if !ok {
		return UpdateUser401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	if request.Body == nil {
		return UpdateUser400JSONResponse{Code: 400, Message: "Missing request body"}, nil
	}

	// Ensure Username (mirroring legacy validation)
	if request.Body.User == "" {
		return UpdateUser400JSONResponse{Code: 400, Message: "User cannot be empty"}, nil
	}

	var err error
	// Handle different operations mirroring legacy appUpdateAdminUsers
	switch request.Body.Operation {
	case "CREATE":
		err = s.createUser(ctx, request.Body.User, request.Body.Password, request.Body.IsAdmin)
	case "UPDATE":
		err = s.updateUser(ctx, request.Body.User, request.Body.Password, request.Body.IsAdmin)
	case "DELETE":
		err = s.deleteUser(ctx, request.Body.User)
	default:
		return UpdateUser400JSONResponse{Code: 400, Message: "Unknown user operation"}, nil
	}

	if err != nil {
		return UpdateUser500JSONResponse{Code: 500, Message: err.Error()}, nil
	}

	// Get updated users list (mirroring legacy appGetAdminUsers)
	users, err := s.db.Queries.GetUsers(ctx)
	if err != nil {
		return UpdateUser500JSONResponse{Code: 500, Message: err.Error()}, nil
	}

	apiUsers := make([]User, len(users))
	for i, user := range users {
		apiUsers[i] = User{
			Id:        user.ID,
			Admin:     user.Admin,
			CreatedAt: parseTime(user.CreatedAt),
		}
	}

	return UpdateUser200JSONResponse{
		Users: &apiUsers,
	}, nil
}

// createUser creates a new user, mirroring legacy createUser
func (s *Server) createUser(ctx context.Context, user string, rawPassword *string, isAdmin *bool) error {
	// Validate Necessary Parameters (mirroring legacy)
	if rawPassword == nil || *rawPassword == "" {
		return fmt.Errorf("password can't be empty")
	}

	// Base Params
	createParams := database.CreateUserParams{
		ID: user,
	}

	// Handle Admin (Explicit or False)
	if isAdmin != nil {
		createParams.Admin = *isAdmin
	} else {
		createParams.Admin = false
	}

	// Parse Password (mirroring legacy)
	password := fmt.Sprintf("%x", md5.Sum([]byte(*rawPassword)))
	hashedPassword, err := argon2.CreateHash(password, argon2.DefaultParams)
	if err != nil {
		return fmt.Errorf("unable to create hashed password")
	}
	createParams.Pass = &hashedPassword

	// Generate Auth Hash (mirroring legacy)
	rawAuthHash, err := utils.GenerateToken(64)
	if err != nil {
		return fmt.Errorf("unable to create token for user")
	}
	authHash := fmt.Sprintf("%x", rawAuthHash)
	createParams.AuthHash = &authHash

	// Create user in DB (mirroring legacy)
	if rows, err := s.db.Queries.CreateUser(ctx, createParams); err != nil {
		return fmt.Errorf("unable to create user")
	} else if rows == 0 {
		return fmt.Errorf("user already exists")
	}

	return nil
}

// updateUser updates an existing user, mirroring legacy updateUser
func (s *Server) updateUser(ctx context.Context, user string, rawPassword *string, isAdmin *bool) error {
	// Validate Necessary Parameters (mirroring legacy)
	if rawPassword == nil && isAdmin == nil {
		return fmt.Errorf("nothing to update")
	}

	// Base Params
	updateParams := database.UpdateUserParams{
		UserID: user,
	}

	// Handle Admin (Update or Existing)
	if isAdmin != nil {
		updateParams.Admin = *isAdmin
	} else {
		userData, err := s.db.Queries.GetUser(ctx, user)
		if err != nil {
			return fmt.Errorf("unable to get user")
		}
		updateParams.Admin = userData.Admin
	}

	// Check Admins - Disallow Demotion (mirroring legacy isLastAdmin)
	if isLast, err := s.isLastAdmin(ctx, user); err != nil {
		return err
	} else if isLast && !updateParams.Admin {
		return fmt.Errorf("unable to demote %s - last admin", user)
	}

	// Handle Password (mirroring legacy)
	if rawPassword != nil {
		if *rawPassword == "" {
			return fmt.Errorf("password can't be empty")
		}

		// Parse Password
		password := fmt.Sprintf("%x", md5.Sum([]byte(*rawPassword)))
		hashedPassword, err := argon2.CreateHash(password, argon2.DefaultParams)
		if err != nil {
			return fmt.Errorf("unable to create hashed password")
		}
		updateParams.Password = &hashedPassword

		// Generate Auth Hash
		rawAuthHash, err := utils.GenerateToken(64)
		if err != nil {
			return fmt.Errorf("unable to create token for user")
		}
		authHash := fmt.Sprintf("%x", rawAuthHash)
		updateParams.AuthHash = &authHash
	}

	// Update User (mirroring legacy)
	_, err := s.db.Queries.UpdateUser(ctx, updateParams)
	if err != nil {
		return fmt.Errorf("unable to update user")
	}

	return nil
}

// deleteUser deletes a user, mirroring legacy deleteUser
func (s *Server) deleteUser(ctx context.Context, user string) error {
	// Check Admins (mirroring legacy isLastAdmin)
	if isLast, err := s.isLastAdmin(ctx, user); err != nil {
		return err
	} else if isLast {
		return fmt.Errorf("unable to delete %s - last admin", user)
	}

	// Create Backup File (mirroring legacy)
	backupFilePath := filepath.Join(s.cfg.ConfigPath, fmt.Sprintf("backups/AnthoLumeBackup_%s.zip", time.Now().Format("20060102150405")))
	backupFile, err := os.Create(backupFilePath)
	if err != nil {
		return err
	}
	defer backupFile.Close()

	// Save Backup File (DB Only) (mirroring legacy)
	w := bufio.NewWriter(backupFile)
	err = s.createBackup(ctx, w, []string{})
	if err != nil {
		return err
	}

	// Delete User (mirroring legacy)
	_, err = s.db.Queries.DeleteUser(ctx, user)
	if err != nil {
		return fmt.Errorf("unable to delete user")
	}

	return nil
}

// isLastAdmin checks if the user is the last admin, mirroring legacy isLastAdmin
func (s *Server) isLastAdmin(ctx context.Context, userID string) (bool, error) {
	allUsers, err := s.db.Queries.GetUsers(ctx)
	if err != nil {
		return false, fmt.Errorf("unable to get users")
	}

	hasAdmin := false
	for _, user := range allUsers {
		if user.Admin && user.ID != userID {
			hasAdmin = true
			break
		}
	}

	return !hasAdmin, nil
}

// GET /admin/import
func (s *Server) GetImportDirectory(ctx context.Context, request GetImportDirectoryRequestObject) (GetImportDirectoryResponseObject, error) {
	_, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetImportDirectory401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	// Handle select parameter - mirroring legacy appGetAdminImport
	if request.Params.Select != nil && *request.Params.Select != "" {
		return GetImportDirectory200JSONResponse{
			CurrentPath: request.Params.Select,
			Items:       &[]DirectoryItem{},
		}, nil
	}

	// Default Path (mirroring legacy logic)
	directory := ""
	if request.Params.Directory != nil && *request.Params.Directory != "" {
		directory = *request.Params.Directory
	} else {
		dPath, err := filepath.Abs(s.cfg.DataPath)
		if err != nil {
			return GetImportDirectory500JSONResponse{Code: 500, Message: "Unable to get data directory absolute path"}, nil
		}
		directory = dPath
	}

	// Read directory entries (mirroring legacy)
	entries, err := os.ReadDir(directory)
	if err != nil {
		return GetImportDirectory500JSONResponse{Code: 500, Message: "Invalid directory"}, nil
	}

	allDirectories := []DirectoryItem{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}

		name := e.Name()
		path := filepath.Join(directory, name)
		allDirectories = append(allDirectories, DirectoryItem{
			Name: &name,
			Path: &path,
		})
	}

	cleanPath := filepath.Clean(directory)

	return GetImportDirectory200JSONResponse{
		CurrentPath: &cleanPath,
		Items:       &allDirectories,
	}, nil
}

// POST /admin/import
func (s *Server) PostImport(ctx context.Context, request PostImportRequestObject) (PostImportResponseObject, error) {
	_, ok := s.getSessionFromContext(ctx)
	if !ok {
		return PostImport401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	if request.Body == nil {
		return PostImport400JSONResponse{Code: 400, Message: "Missing request body"}, nil
	}

	// Get import directory (mirroring legacy)
	importDirectory := filepath.Clean(request.Body.Directory)

	// Get data directory (mirroring legacy)
	absoluteDataPath, _ := filepath.Abs(filepath.Join(s.cfg.DataPath, "documents"))

	// Validate different path (mirroring legacy)
	if absoluteDataPath == importDirectory {
		return PostImport400JSONResponse{Code: 400, Message: "Directory is the same as data path"}, nil
	}

	// Do Transaction (mirroring legacy)
	tx, err := s.db.DB.Begin()
	if err != nil {
		return PostImport500JSONResponse{Code: 500, Message: "Unknown error"}, nil
	}

	// Defer & Start Transaction (mirroring legacy)
	defer func() {
		if err := tx.Rollback(); err != nil {
			log.Error("DB Rollback Error:", err)
		}
	}()
	qtx := s.db.Queries.WithTx(tx)

	// Track imports (mirroring legacy)
	importResults := make([]ImportResult, 0)

	// Walk Directory & Import (mirroring legacy)
	err = filepath.WalkDir(importDirectory, func(importPath string, f fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if f.IsDir() {
			return nil
		}

		// Get relative path (mirroring legacy)
		basePath := importDirectory
		relFilePath, err := filepath.Rel(importDirectory, importPath)
		if err != nil {
			log.Warnf("path error: %v", err)
			return nil
		}

		// Track imports (mirroring legacy)
		iResult := ImportResult{
			Path: &relFilePath,
		}
		defer func() {
			importResults = append(importResults, iResult)
		}()

		// Get metadata (mirroring legacy)
		fileMeta, err := metadata.GetMetadata(importPath)
		if err != nil {
			log.Errorf("metadata error: %v", err)
			errMsg := err.Error()
			iResult.Error = &errMsg
			status := ImportResultStatus("FAILED")
			iResult.Status = &status
			return nil
		}
		iResult.Id = fileMeta.PartialMD5
		name := fmt.Sprintf("%s - %s", *fileMeta.Author, *fileMeta.Title)
		iResult.Name = &name

		// Check already exists (mirroring legacy)
		_, err = qtx.GetDocument(ctx, *fileMeta.PartialMD5)
		if err == nil {
			log.Warnf("document already exists: %s", *fileMeta.PartialMD5)
			status := ImportResultStatus("EXISTS")
			iResult.Status = &status
			return nil
		}

		// Import Copy (mirroring legacy)
		if request.Body.Type == "COPY" {
			// Derive & Sanitize File Name (mirroring legacy deriveBaseFileName)
			relFilePath = s.deriveBaseFileName(fileMeta)
			safePath := filepath.Join(s.cfg.DataPath, "documents", relFilePath)

			// Open Source File
			srcFile, err := os.Open(importPath)
			if err != nil {
				log.Errorf("unable to open current file: %v", err)
				errMsg := err.Error()
				iResult.Error = &errMsg
				return nil
			}
			defer srcFile.Close()

			// Open Destination File
			destFile, err := os.Create(safePath)
			if err != nil {
				log.Errorf("unable to open destination file: %v", err)
				errMsg := err.Error()
				iResult.Error = &errMsg
				return nil
			}
			defer destFile.Close()

			// Copy File
			if _, err = io.Copy(destFile, srcFile); err != nil {
				log.Errorf("unable to save file: %v", err)
				errMsg := err.Error()
				iResult.Error = &errMsg
				return nil
			}

			// Update Base & Path
			basePath = filepath.Join(s.cfg.DataPath, "documents")
			iResult.Path = &relFilePath
		}

		// Upsert document (mirroring legacy)
		if _, err = qtx.UpsertDocument(ctx, database.UpsertDocumentParams{
			ID:          *fileMeta.PartialMD5,
			Title:       fileMeta.Title,
			Author:      fileMeta.Author,
			Description: fileMeta.Description,
			Md5:         fileMeta.MD5,
			Words:       fileMeta.WordCount,
			Filepath:    &relFilePath,
			Basepath:    &basePath,
		}); err != nil {
			log.Errorf("UpsertDocument DB Error: %v", err)
			errMsg := err.Error()
			iResult.Error = &errMsg
			return nil
		}

		status := ImportResultStatus("SUCCESS")
		iResult.Status = &status
		return nil
	})
	if err != nil {
		return PostImport500JSONResponse{Code: 500, Message: fmt.Sprintf("Import Failed: %v", err)}, nil
	}

	// Commit transaction (mirroring legacy)
	if err := tx.Commit(); err != nil {
		log.Error("Transaction Commit DB Error: ", err)
		return PostImport500JSONResponse{Code: 500, Message: fmt.Sprintf("Import DB Error: %v", err)}, nil
	}

	// Sort import results (mirroring legacy importStatusPriority)
	sort.Slice(importResults, func(i int, j int) bool {
		return s.importStatusPriority(*importResults[i].Status) <
			s.importStatusPriority(*importResults[j].Status)
	})

	return PostImport200JSONResponse{
		Results: &importResults,
	}, nil
}

// importStatusPriority returns the order priority for import status, mirroring legacy
func (s *Server) importStatusPriority(status ImportResultStatus) int {
	switch status {
	case "FAILED":
		return 1
	case "EXISTS":
		return 2
	default:
		return 3
	}
}

// deriveBaseFileName builds the base filename for a given MetadataInfo object, mirroring legacy deriveBaseFileName
func (s *Server) deriveBaseFileName(metadataInfo *metadata.MetadataInfo) string {
	var newFileName string
	if *metadataInfo.Author != "" {
		newFileName = newFileName + *metadataInfo.Author
	} else {
		newFileName = newFileName + "Unknown"
	}
	if *metadataInfo.Title != "" {
		newFileName = newFileName + " - " + *metadataInfo.Title
	} else {
		newFileName = newFileName + " - Unknown"
	}

	// Remove Slashes (mirroring legacy)
	fileName := strings.ReplaceAll(newFileName, "/", "")
	return "." + filepath.Clean(fmt.Sprintf("/%s [%s]%s", fileName, *metadataInfo.PartialMD5, metadataInfo.Type))
}

// GET /admin/import-results
func (s *Server) GetImportResults(ctx context.Context, request GetImportResultsRequestObject) (GetImportResultsResponseObject, error) {
	_, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetImportResults401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	// Note: In the legacy implementation, import results are returned directly
	// after import. This endpoint could be enhanced to store results in
	// session or memory for later retrieval. For now, return empty results.
	return GetImportResults200JSONResponse{
		Results: &[]ImportResult{},
	}, nil
}

// GET /admin/logs
func (s *Server) GetLogs(ctx context.Context, request GetLogsRequestObject) (GetLogsResponseObject, error) {
	_, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetLogs401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	page := int64(1)
	if request.Params.Page != nil && *request.Params.Page > 0 {
		page = *request.Params.Page
	}

	limit := int64(100)
	if request.Params.Limit != nil && *request.Params.Limit > 0 {
		limit = *request.Params.Limit
	}

	filter := ""
	if request.Params.Filter != nil {
		filter = strings.TrimSpace(*request.Params.Filter)
	}

	var jqFilter *gojq.Code
	var basicFilter string

	// Parse JQ or basic filter (mirroring legacy)
	if strings.HasPrefix(filter, "\"") && strings.HasSuffix(filter, "\"") {
		basicFilter = filter[1 : len(filter)-1]
	} else if filter != "" {
		parsed, err := gojq.Parse(filter)
		if err != nil {
			log.Error("Unable to parse JQ filter")
			return GetLogs500JSONResponse{Code: 500, Message: "Unable to parse JQ filter"}, nil
		}

		jqFilter, err = gojq.Compile(parsed)
		if err != nil {
			log.Error("Unable to compile JQ filter")
			return GetLogs500JSONResponse{Code: 500, Message: "Unable to compile JQ filter"}, nil
		}
	}

	logPath := filepath.Join(s.cfg.ConfigPath, "logs/antholume.log")
	logFile, err := os.Open(logPath)
	if err != nil {
		return GetLogs500JSONResponse{Code: 500, Message: "Missing AnthoLume log file"}, nil
	}
	defer logFile.Close()

	offset := (page - 1) * limit
	logLines := make([]string, 0, limit)
	matchedCount := int64(0)

	scanner := bufio.NewScanner(logFile)
	for scanner.Scan() {
		formattedLog, matched := formatLogLine(scanner.Text(), basicFilter, jqFilter)
		if !matched {
			continue
		}

		if matchedCount >= offset && int64(len(logLines)) < limit {
			logLines = append(logLines, formattedLog)
		}
		matchedCount++
	}

	if err := scanner.Err(); err != nil {
		return GetLogs500JSONResponse{Code: 500, Message: "Unable to read AnthoLume log file"}, nil
	}

	var nextPage *int64
	var previousPage *int64
	if page > 1 {
		previousPage = ptrOf(page - 1)
	}
	if offset+int64(len(logLines)) < matchedCount {
		nextPage = ptrOf(page + 1)
	}

	return GetLogs200JSONResponse{
		Logs:         &logLines,
		Filter:       &filter,
		Page:         &page,
		Limit:        &limit,
		NextPage:     nextPage,
		PreviousPage: previousPage,
		Total:        &matchedCount,
	}, nil
}

func formatLogLine(rawLog string, basicFilter string, jqFilter *gojq.Code) (string, bool) {
	var jsonMap map[string]any
	if err := json.Unmarshal([]byte(rawLog), &jsonMap); err != nil {
		if basicFilter == "" && jqFilter == nil {
			return rawLog, true
		}
		if basicFilter != "" && strings.Contains(rawLog, basicFilter) {
			return rawLog, true
		}
		return "", false
	}

	rawData, err := json.MarshalIndent(jsonMap, "", "  ")
	if err != nil {
		if basicFilter == "" && jqFilter == nil {
			return rawLog, true
		}
		if basicFilter != "" && strings.Contains(rawLog, basicFilter) {
			return rawLog, true
		}
		return "", false
	}

	formattedLog := string(rawData)
	if basicFilter != "" {
		return formattedLog, strings.Contains(formattedLog, basicFilter)
	}
	if jqFilter == nil {
		return formattedLog, true
	}

	result, _ := jqFilter.Run(jsonMap).Next()
	if _, ok := result.(error); ok {
		return formattedLog, true
	}
	if result == nil {
		return "", false
	}

	filteredData, err := json.MarshalIndent(result, "", "  ")
	if err == nil {
		formattedLog = string(filteredData)
	}

	return formattedLog, true
}
