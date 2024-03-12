package api

import (
	"archive/zip"
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	"github.com/itchyny/gojq"
	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/metadata"
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
)

type requestAdminUpdateUser struct {
	User      string        `form:"user"`
	Password  string        `form:"password"`
	isAdmin   bool          `form:"is_admin"`
	Operation operationType `form:"operation"`
}

type requestAdminLogs struct {
	Filter string `form:"filter"`
}

func (api *API) appPerformAdminAction(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("admin", c)

	var rAdminAction requestAdminAction
	if err := c.ShouldBind(&rAdminAction); err != nil {
		log.Error("Invalid Form Bind: ", err)
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values")
		return
	}

	// TODO - Messages
	switch rAdminAction.Action {
	case adminMetadataMatch:
		// TODO
		// 1. Documents xref most recent metadata table?
		// 2. Select all / deselect?
	case adminCacheTables:
		go api.db.CacheTempTables()
		// TODO - Message
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
	if rAdminLogs.Filter != "" {
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
		var jsonMap map[string]interface{}
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

		// No Filter
		if jqFilter == nil {
			logLines = append(logLines, string(rawData))
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

	var rAdminUserUpdate requestAdminUpdateUser
	if err := c.ShouldBind(&rAdminUserUpdate); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid user update")
		return
	}

	var err error
	switch rAdminUserUpdate.Operation {
	case opCreate:
		err = api.createUser(rAdminUserUpdate.User, rAdminUserUpdate.Password)
	case opUpdate:
		err = fmt.Errorf("unimplemented")
	default:
		appErrorPage(c, http.StatusNotFound, "Unknown user operation")
		return

	}

	if err != nil {
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("Unable to create user: %v", err))
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

	// TODO - Store results for approval?

	// Walk import directory & copy or import files
	importDirectory := filepath.Clean(rAdminImport.Directory)
	_ = filepath.WalkDir(importDirectory, func(currentPath string, f fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if f.IsDir() {
			return nil
		}

		// Get metadata
		fileMeta, err := metadata.GetMetadata(currentPath)
		if err != nil {
			fmt.Printf("metadata error: %v\n", err)
			return nil
		}

		// Only needed if copying
		newName := deriveBaseFileName(fileMeta)

		// Open File on Disk
		// file, err := os.Open(currentPath)
		// if err != nil {
		// 	return err
		// }
		// defer file.Close()

		// TODO - BasePath in DB
		// TODO - Copy / Import

		fmt.Printf("New File Metadata: %s\n", newName)

		return nil
	})

	templateVars["CurrentPath"] = filepath.Clean(rAdminImport.Directory)

	c.HTML(http.StatusOK, "page/admin-import", templateVars)
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

	// Vacuum DB
	_, err = api.db.DB.ExecContext(api.db.Ctx, "VACUUM;")
	if err != nil {
		log.Error("Unable to vacuum DB: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to vacuum database")
		return
	}

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

// Restore all data
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
			fmt.Println("Error creating destination file:", err)
			return err
		}
		defer destFile.Close()

		// Copy the contents from the zip file to the destination file.
		if _, err := io.Copy(destFile, rc); err != nil {
			fmt.Println("Error copying file contents:", err)
			return err
		}
	}

	return nil
}

// Remove all data
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

// Backup all data
func (api *API) createBackup(w io.Writer, directories []string) error {
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
	io.Copy(newDbFile, dbFile)

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
