package api

import (
	"archive/zip"
	"bufio"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	argon2 "github.com/alexedwards/argon2id"
	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	"github.com/itchyny/gojq"
	"github.com/pkg/errors"
	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/utils"
)

type adminAction string

const (
	adminBackup        adminAction = "BACKUP"
	adminRestore       adminAction = "RESTORE"
	adminMetadataMatch adminAction = "METADATA_MATCH"
	adminCacheTables   adminAction = "CACHE_TABLES"
)

type requestAdminAction struct {
	Action adminAction `form:"action"`

	// Backup Action
	BackupTypes []backupType `form:"backup_types"`

	// Restore Action
	RestoreFile *multipart.FileHeader `form:"restore_file"`
}

type importType string

const (
	importDirect importType = "DIRECT"
	importCopy   importType = "COPY"
)

type requestAdminImport struct {
	Directory string     `form:"directory"`
	Select    string     `form:"select"`
	Type      importType `form:"type"`
}

type operationType string

const (
	opUpdate operationType = "UPDATE"
	opCreate operationType = "CREATE"
	opDelete operationType = "DELETE"
)

type requestAdminUpdateUser struct {
	User      string        `form:"user"`
	Password  *string       `form:"password"`
	IsAdmin   *bool         `form:"is_admin"`
	Operation operationType `form:"operation"`
}

type requestAdminLogs struct {
	Filter string `form:"filter"`
}

type importStatus string

const (
	importFailed  importStatus = "FAILED"
	importSuccess importStatus = "SUCCESS"
	importExists  importStatus = "EXISTS"
)

type importResult struct {
	ID     string
	Name   string
	Path   string
	Status importStatus
	Error  error
}

func (api *API) appPerformAdminAction(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin", c)

	var rAdminAction requestAdminAction
	if err := c.ShouldBind(&rAdminAction); err != nil {
		log.Error("Invalid Form Bind: ", err)
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values")
		return
	}

	switch rAdminAction.Action {
	case adminMetadataMatch:
		// TODO
		// 1. Documents xref most recent metadata table?
		// 2. Select all / deselect?
	case adminCacheTables:
		go func() {
			err := api.db.CacheTempTables()
			if err != nil {
				log.Error("Unable to cache temp tables: ", err)
			}
		}()
	case adminRestore:
		api.processRestoreFile(rAdminAction, c)
		return
	case adminBackup:
		// Vacuum
		_, err := api.db.DB.ExecContext(api.db.Ctx, "VACUUM;")
		if err != nil {
			log.Error("Unable to vacuum DB: ", err)
			appErrorPage(c, http.StatusInternalServerError, "Unable to vacuum database")
			return
		}

		// Set Headers
		c.Header("Content-type", "application/octet-stream")
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"AnthoLumeBackup_%s.zip\"", time.Now().Format("20060102150405")))

		// Stream Backup ZIP Archive
		c.Stream(func(w io.Writer) bool {
			var directories []string
			for _, item := range rAdminAction.BackupTypes {
				if item == backupCovers {
					directories = append(directories, "covers")
				} else if item == backupDocuments {
					directories = append(directories, "documents")
				}
			}

			err := api.createBackup(w, directories)
			if err != nil {
				log.Error("Backup Error: ", err)
			}
			return false
		})

		return
	}

	c.HTML(http.StatusOK, "page/admin", templateVars)
}

func (api *API) appGetAdmin(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin", c)
	c.HTML(http.StatusOK, "page/admin", templateVars)
}

func (api *API) appGetAdminLogs(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin-logs", c)

	var rAdminLogs requestAdminLogs
	if err := c.ShouldBindQuery(&rAdminLogs); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid URI parameters")
		return
	}
	rAdminLogs.Filter = strings.TrimSpace(rAdminLogs.Filter)

	var jqFilter *gojq.Code
	var basicFilter string
	if strings.HasPrefix(rAdminLogs.Filter, "\"") && strings.HasSuffix(rAdminLogs.Filter, "\"") {
		basicFilter = rAdminLogs.Filter[1 : len(rAdminLogs.Filter)-1]
	} else if rAdminLogs.Filter != "" {
		parsed, err := gojq.Parse(rAdminLogs.Filter)
		if err != nil {
			log.Error("Unable to parse JQ filter")
			appErrorPage(c, http.StatusNotFound, "Unable to parse JQ filter")
			return
		}

		jqFilter, err = gojq.Compile(parsed)
		if err != nil {
			log.Error("Unable to compile JQ filter")
			appErrorPage(c, http.StatusNotFound, "Unable to compile JQ filter")
			return
		}
	}

	// Open Log File
	logPath := filepath.Join(api.cfg.ConfigPath, "logs/antholume.log")
	logFile, err := os.Open(logPath)
	if err != nil {
		appErrorPage(c, http.StatusBadRequest, "Missing AnthoLume log file")
		return
	}
	defer logFile.Close()

	// Log Lines
	var logLines []string
	scanner := bufio.NewScanner(logFile)
	for scanner.Scan() {
		rawLog := scanner.Text()

		// Attempt JSON Pretty
		var jsonMap map[string]any
		err := json.Unmarshal([]byte(rawLog), &jsonMap)
		if err != nil {
			logLines = append(logLines, scanner.Text())
			continue
		}

		// Parse JSON
		rawData, err := json.MarshalIndent(jsonMap, "", "  ")
		if err != nil {
			logLines = append(logLines, scanner.Text())
			continue
		}

		// Basic Filter
		if basicFilter != "" && strings.Contains(string(rawData), basicFilter) {
			logLines = append(logLines, string(rawData))
			continue
		}

		// No JQ Filter
		if jqFilter == nil {
			continue
		}

		// Error or nil
		result, _ := jqFilter.Run(jsonMap).Next()
		if _, ok := result.(error); ok {
			logLines = append(logLines, string(rawData))
			continue
		} else if result == nil {
			continue
		}

		// Attempt filtered json
		filteredData, err := json.MarshalIndent(result, "", "  ")
		if err == nil {
			rawData = filteredData
		}

		logLines = append(logLines, string(rawData))
	}

	templateVars["Data"] = logLines
	templateVars["Filter"] = rAdminLogs.Filter

	c.HTML(http.StatusOK, "page/admin-logs", templateVars)
}

func (api *API) appGetAdminUsers(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin-users", c)

	users, err := api.db.Queries.GetUsers(api.db.Ctx)
	if err != nil {
		log.Error("GetUsers DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUsers DB Error: %v", err))
		return
	}

	templateVars["Data"] = users

	c.HTML(http.StatusOK, "page/admin-users", templateVars)
}

func (api *API) appUpdateAdminUsers(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin-users", c)

	var rUpdate requestAdminUpdateUser
	if err := c.ShouldBind(&rUpdate); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid user parameters")
		return
	}

	// Ensure Username
	if rUpdate.User == "" {
		appErrorPage(c, http.StatusInternalServerError, "User cannot be empty")
		return
	}

	var err error
	switch rUpdate.Operation {
	case opCreate:
		err = api.createUser(rUpdate.User, rUpdate.Password, rUpdate.IsAdmin)
	case opUpdate:
		err = api.updateUser(rUpdate.User, rUpdate.Password, rUpdate.IsAdmin)
	case opDelete:
		err = api.deleteUser(rUpdate.User)
	default:
		appErrorPage(c, http.StatusNotFound, "Unknown user operation")
		return
	}

	if err != nil {
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Unable to create or update user: %v", err))
		return
	}

	users, err := api.db.Queries.GetUsers(api.db.Ctx)
	if err != nil {
		log.Error("GetUsers DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetUsers DB Error: %v", err))
		return
	}

	templateVars["Data"] = users

	c.HTML(http.StatusOK, "page/admin-users", templateVars)
}

func (api *API) appGetAdminImport(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin-import", c)

	var rImportFolder requestAdminImport
	if err := c.ShouldBindQuery(&rImportFolder); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid directory")
		return
	}

	if rImportFolder.Select != "" {
		templateVars["SelectedDirectory"] = rImportFolder.Select
		c.HTML(http.StatusOK, "page/admin-import", templateVars)
		return
	}

	// Default Path
	if rImportFolder.Directory == "" {
		dPath, err := filepath.Abs(api.cfg.DataPath)
		if err != nil {
			log.Error("Absolute filepath error: ", rImportFolder.Directory)
			appErrorPage(c, http.StatusNotFound, "Unable to get data directory absolute path")
			return
		}

		rImportFolder.Directory = dPath
	}

	entries, err := os.ReadDir(rImportFolder.Directory)
	if err != nil {
		log.Error("Invalid directory: ", rImportFolder.Directory)
		appErrorPage(c, http.StatusNotFound, "Invalid directory")
		return
	}

	allDirectories := []string{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}

		allDirectories = append(allDirectories, e.Name())
	}

	templateVars["CurrentPath"] = filepath.Clean(rImportFolder.Directory)
	templateVars["Data"] = allDirectories

	c.HTML(http.StatusOK, "page/admin-import", templateVars)
}

func (api *API) appPerformAdminImport(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin-import", c)

	var rAdminImport requestAdminImport
	if err := c.ShouldBind(&rAdminImport); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid directory")
		return
	}

	// Get import directory
	importDirectory := filepath.Clean(rAdminImport.Directory)

	// Get data directory
	absoluteDataPath, _ := filepath.Abs(filepath.Join(api.cfg.DataPath, "documents"))

	// Validate different path
	if absoluteDataPath == importDirectory {
		appErrorPage(c, http.StatusBadRequest, "Directory is the same as data path")
		return
	}

	// Do Transaction
	tx, err := api.db.DB.Begin()
	if err != nil {
		log.Error("Transaction Begin DB Error:", err)
		apiErrorPage(c, http.StatusBadRequest, "Unknown error")
		return
	}

	// Defer & Start Transaction
	defer func() {
		if err := tx.Rollback(); err != nil {
			log.Error("DB Rollback Error:", err)
		}
	}()
	qtx := api.db.Queries.WithTx(tx)

	// Track imports
	importResults := make([]importResult, 0)

	// Walk Directory & Import
	err = filepath.WalkDir(importDirectory, func(importPath string, f fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if f.IsDir() {
			return nil
		}

		// Get relative path
		basePath := importDirectory
		relFilePath, err := filepath.Rel(importDirectory, importPath)
		if err != nil {
			log.Warnf("path error: %v", err)
			return nil
		}

		// Track imports
		iResult := importResult{
			Path:   relFilePath,
			Status: importFailed,
		}
		defer func() {
			importResults = append(importResults, iResult)
		}()

		// Get metadata
		fileMeta, err := metadata.GetMetadata(importPath)
		if err != nil {
			log.Errorf("metadata error: %v", err)
			iResult.Error = err
			return nil
		}
		iResult.ID = *fileMeta.PartialMD5
		iResult.Name = fmt.Sprintf("%s - %s", *fileMeta.Author, *fileMeta.Title)

		// Check already exists
		_, err = qtx.GetDocument(api.db.Ctx, *fileMeta.PartialMD5)
		if err == nil {
			log.Warnf("document already exists: %s", *fileMeta.PartialMD5)
			iResult.Status = importExists
			return nil
		}

		// Import Copy
		if rAdminImport.Type == importCopy {
			// Derive & Sanitize File Name
			relFilePath = deriveBaseFileName(fileMeta)
			safePath := filepath.Join(api.cfg.DataPath, "documents", relFilePath)

			// Open Source File
			srcFile, err := os.Open(importPath)
			if err != nil {
				log.Errorf("unable to open current file: %v", err)
				iResult.Error = err
				return nil
			}
			defer srcFile.Close()

			// Open Destination File
			destFile, err := os.Create(safePath)
			if err != nil {
				log.Errorf("unable to open destination file: %v", err)
				iResult.Error = err
				return nil
			}
			defer destFile.Close()

			// Copy File
			if _, err = io.Copy(destFile, srcFile); err != nil {
				log.Errorf("unable to save file: %v", err)
				iResult.Error = err
				return nil
			}

			// Update Base & Path
			basePath = filepath.Join(api.cfg.DataPath, "documents")
			iResult.Path = relFilePath
		}

		// Upsert document
		if _, err = qtx.UpsertDocument(api.db.Ctx, database.UpsertDocumentParams{
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
			iResult.Error = err
			return nil
		}

		iResult.Status = importSuccess
		return nil
	})
	if err != nil {
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Import Failed: %v", err))
		return
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		log.Error("Transaction Commit DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Import DB Error: %v", err))
		return
	}

	// Sort import results
	sort.Slice(importResults, func(i int, j int) bool {
		return importStatusPriority(importResults[i].Status) <
			importStatusPriority(importResults[j].Status)
	})

	templateVars["Data"] = importResults
	c.HTML(http.StatusOK, "page/admin-import-results", templateVars)
}

func (api *API) processRestoreFile(rAdminAction requestAdminAction, c *gin.Context) {
	// Validate Type & Derive Extension on MIME
	uploadedFile, err := rAdminAction.RestoreFile.Open()
	if err != nil {
		log.Error("File Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to open file")
		return
	}

	fileMime, err := mimetype.DetectReader(uploadedFile)
	if err != nil {
		log.Error("MIME Error")
		appErrorPage(c, http.StatusInternalServerError, "Unable to detect filetype")
		return
	}
	fileExtension := fileMime.Extension()

	// Validate Extension
	if !slices.Contains([]string{".zip"}, fileExtension) {
		log.Error("Invalid FileType: ", fileExtension)
		appErrorPage(c, http.StatusBadRequest, "Invalid filetype")
		return
	}

	// Create Temp File
	tempFile, err := os.CreateTemp("", "restore")
	if err != nil {
		log.Warn("Temp File Create Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to create temp file")
		return
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Save Temp
	err = c.SaveUploadedFile(rAdminAction.RestoreFile, tempFile.Name())
	if err != nil {
		log.Error("File Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to save file")
		return
	}

	// ZIP Info
	fileInfo, err := tempFile.Stat()
	if err != nil {
		log.Error("File Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to read file")
		return
	}

	// Create ZIP Reader
	zipReader, err := zip.NewReader(tempFile, fileInfo.Size())
	if err != nil {
		log.Error("ZIP Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to read zip")
		return
	}

	// Validate ZIP Contents
	hasDBFile := false
	hasUnknownFile := false
	for _, file := range zipReader.File {
		fileName := strings.TrimPrefix(file.Name, "/")
		if fileName == "antholume.db" {
			hasDBFile = true
			break
		} else if !strings.HasPrefix(fileName, "covers/") && !strings.HasPrefix(fileName, "documents/") {
			hasUnknownFile = true
			break
		}
	}

	// Invalid ZIP
	if !hasDBFile {
		log.Error("Invalid ZIP File - Missing DB")
		appErrorPage(c, http.StatusInternalServerError, "Invalid Restore ZIP - Missing DB")
		return
	} else if hasUnknownFile {
		log.Error("Invalid ZIP File - Invalid File(s)")
		appErrorPage(c, http.StatusInternalServerError, "Invalid Restore ZIP - Invalid File(s)")
		return
	}

	// Create Backup File
	backupFilePath := filepath.Join(api.cfg.ConfigPath, fmt.Sprintf("backups/AnthoLumeBackup_%s.zip", time.Now().Format("20060102150405")))
	backupFile, err := os.Create(backupFilePath)
	if err != nil {
		log.Error("Unable to create backup file: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to create backup file")
		return
	}
	defer backupFile.Close()

	// Save Backup File
	w := bufio.NewWriter(backupFile)
	err = api.createBackup(w, []string{"covers", "documents"})
	if err != nil {
		log.Error("Unable to save backup file: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to save backup file")
		return
	}

	// Remove Data
	err = api.removeData()
	if err != nil {
		log.Error("Unable to delete data: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to delete data")
		return
	}

	// Restore Data
	err = api.restoreData(zipReader)
	if err != nil {
		appErrorPage(c, http.StatusInternalServerError, "Unable to restore data")
		log.Panic("Unable to restore data: ", err)
	}

	// Reinit DB
	if err := api.db.Reload(); err != nil {
		appErrorPage(c, http.StatusInternalServerError, "Unable to reload DB")
		log.Panicf("Unable to reload DB: %v", err)
	}

	// Rotate Auth Hashes
	if err := api.rotateAllAuthHashes(); err != nil {
		appErrorPage(c, http.StatusInternalServerError, "Unable to rotate hashes")
		log.Panicf("Unable to rotate auth hashes: %v", err)
	}

	// Redirect to login page
	c.Redirect(http.StatusFound, "/login")
}

func (api *API) restoreData(zipReader *zip.Reader) error {
	// Ensure Directories
	api.cfg.EnsureDirectories()

	// Restore Data
	for _, file := range zipReader.File {
		rc, err := file.Open()
		if err != nil {
			return err
		}
		defer rc.Close()

		destPath := filepath.Join(api.cfg.DataPath, file.Name)
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

func (api *API) removeData() error {
	allPaths := []string{
		"covers",
		"documents",
		"antholume.db",
		"antholume.db-wal",
		"antholume.db-shm",
	}

	for _, name := range allPaths {
		fullPath := filepath.Join(api.cfg.DataPath, name)
		err := os.RemoveAll(fullPath)
		if err != nil {
			log.Errorf("Unable to delete %s: %v", name, err)
			return err
		}

	}

	return nil
}

func (api *API) createBackup(w io.Writer, directories []string) error {
	// Vacuum DB
	_, err := api.db.DB.ExecContext(api.db.Ctx, "VACUUM;")
	if err != nil {
		return errors.Wrap(err, "Unable to vacuum database")
	}

	ar := zip.NewWriter(w)
	exportWalker := func(currentPath string, f fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if f.IsDir() {
			return nil
		}

		// Open File on Disk
		file, err := os.Open(currentPath)
		if err != nil {
			return err
		}
		defer file.Close()

		// Derive Export Structure
		fileName := filepath.Base(currentPath)
		folderName := filepath.Base(filepath.Dir(currentPath))

		// Create File in Export
		newF, err := ar.Create(filepath.Join(folderName, fileName))
		if err != nil {
			return err
		}

		// Copy File in Export
		_, err = io.Copy(newF, file)
		if err != nil {
			return err
		}

		return nil
	}

	// Get DB Path
	fileName := fmt.Sprintf("%s.db", api.cfg.DBName)
	dbLocation := filepath.Join(api.cfg.ConfigPath, fileName)

	// Copy Database File
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

	// Backup Covers & Documents
	for _, dir := range directories {
		err = filepath.WalkDir(filepath.Join(api.cfg.DataPath, dir), exportWalker)
		if err != nil {
			return err
		}
	}

	ar.Close()
	return nil
}

func (api *API) isLastAdmin(userID string) (bool, error) {
	allUsers, err := api.db.Queries.GetUsers(api.db.Ctx)
	if err != nil {
		return false, errors.Wrap(err, fmt.Sprintf("GetUsers DB Error: %v", err))
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

func (api *API) createUser(user string, rawPassword *string, isAdmin *bool) error {
	// Validate Necessary Parameters
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

	// Parse Password
	password := fmt.Sprintf("%x", md5.Sum([]byte(*rawPassword)))
	hashedPassword, err := argon2.CreateHash(password, argon2.DefaultParams)
	if err != nil {
		return fmt.Errorf("unable to create hashed password")
	}
	createParams.Pass = &hashedPassword

	// Generate Auth Hash
	rawAuthHash, err := utils.GenerateToken(64)
	if err != nil {
		return fmt.Errorf("unable to create token for user")
	}
	authHash := fmt.Sprintf("%x", rawAuthHash)
	createParams.AuthHash = &authHash

	// Create user in DB
	if rows, err := api.db.Queries.CreateUser(api.db.Ctx, createParams); err != nil {
		log.Error("CreateUser DB Error:", err)
		return fmt.Errorf("unable to create user")
	} else if rows == 0 {
		log.Warn("User Already Exists:", createParams.ID)
		return fmt.Errorf("user already exists")
	}

	return nil
}

func (api *API) updateUser(user string, rawPassword *string, isAdmin *bool) error {
	// Validate Necessary Parameters
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
		user, err := api.db.Queries.GetUser(api.db.Ctx, user)
		if err != nil {
			return errors.Wrap(err, fmt.Sprintf("GetUser DB Error: %v", err))
		}
		updateParams.Admin = user.Admin
	}

	// Check Admins - Disallow Demotion
	if isLast, err := api.isLastAdmin(user); err != nil {
		return err
	} else if isLast && !updateParams.Admin {
		return fmt.Errorf("unable to demote %s - last admin", user)
	}

	// Handle Password
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

	// Update User
	_, err := api.db.Queries.UpdateUser(api.db.Ctx, updateParams)
	if err != nil {
		return errors.Wrap(err, fmt.Sprintf("UpdateUser DB Error: %v", err))
	}

	return nil
}

func (api *API) deleteUser(user string) error {
	// Check Admins
	if isLast, err := api.isLastAdmin(user); err != nil {
		return err
	} else if isLast {
		return fmt.Errorf("unable to delete %s - last admin", user)
	}

	// Create Backup File
	backupFilePath := filepath.Join(api.cfg.ConfigPath, fmt.Sprintf("backups/AnthoLumeBackup_%s.zip", time.Now().Format("20060102150405")))
	backupFile, err := os.Create(backupFilePath)
	if err != nil {
		return err
	}
	defer backupFile.Close()

	// Save Backup File (DB Only)
	w := bufio.NewWriter(backupFile)
	err = api.createBackup(w, []string{})
	if err != nil {
		return err
	}

	// Delete User
	_, err = api.db.Queries.DeleteUser(api.db.Ctx, user)
	if err != nil {
		return errors.Wrap(err, fmt.Sprintf("DeleteUser DB Error: %v", err))
	}

	return nil
}
