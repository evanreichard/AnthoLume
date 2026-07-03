package database

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"

	"reichard.io/antholume/config"
	"reichard.io/antholume/pkg/ptr"
	"reichard.io/antholume/utils"
)

type DocumentsTestSuite struct {
	suite.Suite
	dbm *DBManager
}

func TestDocuments(t *testing.T) {
	suite.Run(t, new(DocumentsTestSuite))
}

func (suite *DocumentsTestSuite) SetupTest() {
	cfg := config.Config{
		DBType: "memory",
	}

	suite.dbm = NewMgr(&cfg)

	// Create Document
	_, err := suite.dbm.Queries.UpsertDocument(context.Background(), UpsertDocumentParams{
		ID:     documentID,
		Title:  &documentTitle,
		Author: &documentAuthor,
		Words:  &documentWords,
	})
	suite.NoError(err)
}

func (suite *DocumentsTestSuite) seedDocumentStats() {
	suite.createTestUserAndDevice()

	var err error
	_, err = suite.dbm.Queries.AddActivity(context.Background(), AddActivityParams{
		DocumentID:      documentID,
		DeviceID:        deviceID,
		UserID:          userID,
		StartTime:       time.Now().UTC().Format(time.RFC3339),
		Duration:        60,
		StartPercentage: 0.10,
		EndPercentage:   0.20,
	})
	suite.Require().NoError(err)

	_, err = suite.dbm.Queries.UpdateProgress(context.Background(), UpdateProgressParams{
		UserID:     userID,
		DocumentID: documentID,
		DeviceID:   deviceID,
		Percentage: 0.42,
		Progress:   "/6/2[test]",
	})
	suite.Require().NoError(err)

	err = suite.dbm.CacheTempTables(context.Background())
	suite.Require().NoError(err)
}

func (suite *DocumentsTestSuite) createTestUserAndDevice() {
	rawAuthHash, err := utils.GenerateToken(64)
	suite.Require().NoError(err)
	authHash := fmt.Sprintf("%x", rawAuthHash)

	_, err = suite.dbm.Queries.CreateUser(context.Background(), CreateUserParams{
		ID:       userID,
		Pass:     &userPass,
		AuthHash: &authHash,
	})
	suite.Require().NoError(err)

	_, err = suite.dbm.Queries.UpsertDevice(context.Background(), UpsertDeviceParams{
		ID:         deviceID,
		UserID:     userID,
		DeviceName: deviceName,
	})
	suite.Require().NoError(err)
}

func (suite *DocumentsTestSuite) TestGetDocument() {
	doc, err := suite.dbm.Queries.GetDocument(context.Background(), documentID)
	suite.Nil(err, "should have nil err")
	suite.Equal(documentID, doc.ID, "should have changed the document")
}

func (suite *DocumentsTestSuite) TestUpsertDocument() {
	testDocID := "docid1"

	doc, err := suite.dbm.Queries.UpsertDocument(context.Background(), UpsertDocumentParams{
		ID:     testDocID,
		Title:  &documentTitle,
		Author: &documentAuthor,
	})

	suite.Nil(err, "should have nil err")
	suite.Equal(testDocID, doc.ID, "should have document id")
	suite.Equal(documentTitle, *doc.Title, "should have document title")
	suite.Equal(documentAuthor, *doc.Author, "should have document author")
}

func (suite *DocumentsTestSuite) TestGetDocumentProgress() {
	suite.seedDocumentStats()

	progress, err := suite.dbm.Queries.GetDocumentProgress(context.Background(), GetDocumentProgressParams{
		UserID:     userID,
		DocumentID: documentID,
	})

	suite.NoError(err)
	suite.Equal(userID, progress.UserID)
	suite.Equal(documentID, progress.DocumentID)
	suite.Equal(deviceID, progress.DeviceID)
	suite.Equal(deviceName, progress.DeviceName)
	suite.Equal(0.42, progress.Percentage)
	suite.Equal("/6/2[test]", progress.Progress)
}

func (suite *DocumentsTestSuite) TestGetDocumentWithStats() {
	suite.seedDocumentStats()

	doc, err := suite.dbm.GetDocument(context.Background(), documentID, userID)

	suite.NoError(err)
	suite.Equal(documentID, doc.ID)
	suite.Equal(documentTitle, *doc.Title)
	suite.Equal(documentAuthor, *doc.Author)
	suite.Equal(documentWords, *doc.Words)
	suite.Equal(float64(42), doc.Percentage)
	suite.Equal(int64(60), doc.TotalTimeSeconds)
	suite.Equal(int64(500), doc.Wpm)
	suite.Equal(int64(6), doc.SecondsPerPercent)
}

func (suite *DocumentsTestSuite) TestGetDocumentsSize() {
	count, err := suite.dbm.Queries.GetDocumentsSize(context.Background(), nil)

	suite.NoError(err)
	suite.Equal(int64(1), count)

	count, err = suite.dbm.Queries.GetDocumentsSize(context.Background(), "%testTitle%")
	suite.NoError(err)
	suite.Equal(int64(1), count)

	count, err = suite.dbm.Queries.GetDocumentsSize(context.Background(), "%missing%")
	suite.NoError(err)
	suite.Equal(int64(0), count)
}

func (suite *DocumentsTestSuite) TestGetDocumentsWithStatsCount() {
	count, err := suite.dbm.Queries.GetDocumentsWithStatsCount(context.Background(), GetDocumentsWithStatsCountParams{})
	suite.NoError(err)
	suite.Equal(int64(1), count)

	count, err = suite.dbm.Queries.GetDocumentsWithStatsCount(context.Background(), GetDocumentsWithStatsCountParams{
		Query: ptr.Of("%testTitle%"),
	})
	suite.NoError(err)
	suite.Equal(int64(1), count)

	count, err = suite.dbm.Queries.GetDocumentsWithStatsCount(context.Background(), GetDocumentsWithStatsCountParams{
		Query: ptr.Of("%testAuthor%"),
	})
	suite.NoError(err)
	suite.Equal(int64(1), count)

	count, err = suite.dbm.Queries.GetDocumentsWithStatsCount(context.Background(), GetDocumentsWithStatsCountParams{
		Query: ptr.Of("%missing%"),
	})
	suite.NoError(err)
	suite.Equal(int64(0), count)

	count, err = suite.dbm.Queries.GetDocumentsWithStatsCount(context.Background(), GetDocumentsWithStatsCountParams{
		ID: ptr.Of(documentID),
	})
	suite.NoError(err)
	suite.Equal(int64(1), count)

	count, err = suite.dbm.Queries.GetDocumentsWithStatsCount(context.Background(), GetDocumentsWithStatsCountParams{
		ID: ptr.Of("missing-id"),
	})
	suite.NoError(err)
	suite.Equal(int64(0), count)

	_, err = suite.dbm.Queries.DeleteDocument(context.Background(), documentID)
	suite.Require().NoError(err)

	count, err = suite.dbm.Queries.GetDocumentsWithStatsCount(context.Background(), GetDocumentsWithStatsCountParams{
		Deleted: ptr.Of(false),
	})
	suite.NoError(err)
	suite.Equal(int64(0), count)

	count, err = suite.dbm.Queries.GetDocumentsWithStatsCount(context.Background(), GetDocumentsWithStatsCountParams{
		Deleted: ptr.Of(true),
	})
	suite.NoError(err)
	suite.Equal(int64(1), count)

	count, err = suite.dbm.Queries.GetDocumentsWithStatsCount(context.Background(), GetDocumentsWithStatsCountParams{})
	suite.NoError(err)
	suite.Equal(int64(1), count)

	count, err = suite.dbm.Queries.GetDocumentsWithStatsCount(context.Background(), GetDocumentsWithStatsCountParams{
		ID:      ptr.Of(documentID),
		Deleted: ptr.Of(true),
	})
	suite.NoError(err)
	suite.Equal(int64(1), count)
}

func (suite *DocumentsTestSuite) TestGetDocumentsWithStats() {
	suite.seedDocumentStats()

	rows, err := suite.dbm.Queries.GetDocumentsWithStats(context.Background(), GetDocumentsWithStatsParams{
		UserID:  userID,
		Deleted: ptr.Of(false),
		Query:   ptr.Of("%testTitle%"),
		Offset:  0,
		Limit:   10,
	})

	suite.NoError(err)
	suite.Len(rows, 1)
	suite.Equal(documentID, rows[0].ID)
	suite.Equal(documentTitle, *rows[0].Title)
	suite.Equal(float64(42), rows[0].Percentage)
	suite.Equal(int64(60), rows[0].TotalTimeSeconds)

	_, err = suite.dbm.Queries.DeleteDocument(context.Background(), documentID)
	suite.NoError(err)

	rows, err = suite.dbm.Queries.GetDocumentsWithStats(context.Background(), GetDocumentsWithStatsParams{
		UserID:  userID,
		Deleted: ptr.Of(false),
		Offset:  0,
		Limit:   10,
	})
	suite.NoError(err)
	suite.Len(rows, 0)
}

func (suite *DocumentsTestSuite) TestGetDocumentsWithStatsFilters() {
	suite.createTestUserAndDevice()

	otherDocID := "testDocument2"
	otherTitle := "otherTitle"
	otherAuthor := "otherAuthor"
	otherWords := int64(3000)
	_, err := suite.dbm.Queries.UpsertDocument(context.Background(), UpsertDocumentParams{
		ID:     otherDocID,
		Title:  &otherTitle,
		Author: &otherAuthor,
		Words:  &otherWords,
	})
	suite.Require().NoError(err)

	_, err = suite.dbm.Queries.AddActivity(context.Background(), AddActivityParams{
		DocumentID:      documentID,
		DeviceID:        deviceID,
		UserID:          userID,
		StartTime:       time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339),
		Duration:        60,
		StartPercentage: 0.10,
		EndPercentage:   0.20,
	})
	suite.Require().NoError(err)

	_, err = suite.dbm.Queries.UpdateProgress(context.Background(), UpdateProgressParams{
		UserID:     userID,
		DocumentID: documentID,
		DeviceID:   deviceID,
		Percentage: 0.42,
		Progress:   "/6/2[test]",
	})
	suite.Require().NoError(err)

	_, err = suite.dbm.Queries.AddActivity(context.Background(), AddActivityParams{
		DocumentID:      otherDocID,
		DeviceID:        deviceID,
		UserID:          userID,
		StartTime:       time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339),
		Duration:        30,
		StartPercentage: 0.20,
		EndPercentage:   0.30,
	})
	suite.Require().NoError(err)

	err = suite.dbm.CacheTempTables(context.Background())
	suite.Require().NoError(err)

	rows, err := suite.dbm.Queries.GetDocumentsWithStats(context.Background(), GetDocumentsWithStatsParams{
		UserID: userID,
		ID:     ptr.Of(documentID),
		Offset: 0,
		Limit:  10,
	})
	suite.NoError(err)
	suite.Len(rows, 1)
	suite.Equal(documentID, rows[0].ID)

	rows, err = suite.dbm.Queries.GetDocumentsWithStats(context.Background(), GetDocumentsWithStatsParams{
		UserID: userID,
		Query:  ptr.Of("%otherAuthor%"),
		Offset: 0,
		Limit:  10,
	})
	suite.NoError(err)
	suite.Len(rows, 1)
	suite.Equal(otherDocID, rows[0].ID)

	rows, err = suite.dbm.Queries.GetDocumentsWithStats(context.Background(), GetDocumentsWithStatsParams{
		UserID: userID,
		Query:  ptr.Of("%does-not-match%"),
		Offset: 0,
		Limit:  10,
	})
	suite.NoError(err)
	suite.Len(rows, 0)

	_, err = suite.dbm.Queries.DeleteDocument(context.Background(), otherDocID)
	suite.Require().NoError(err)

	rows, err = suite.dbm.Queries.GetDocumentsWithStats(context.Background(), GetDocumentsWithStatsParams{
		UserID:  userID,
		Deleted: ptr.Of(true),
		Offset:  0,
		Limit:   10,
	})
	suite.NoError(err)
	suite.Len(rows, 1)
	suite.Equal(otherDocID, rows[0].ID)

	rows, err = suite.dbm.Queries.GetDocumentsWithStats(context.Background(), GetDocumentsWithStatsParams{
		UserID: userID,
		Offset: 0,
		Limit:  10,
	})
	suite.NoError(err)
	suite.Len(rows, 2)

	rows, err = suite.dbm.Queries.GetDocumentsWithStats(context.Background(), GetDocumentsWithStatsParams{
		UserID: userID,
		Offset: 0,
		Limit:  1,
	})
	suite.NoError(err)
	suite.Len(rows, 1)
	suite.Equal(otherDocID, rows[0].ID)

	rows, err = suite.dbm.Queries.GetDocumentsWithStats(context.Background(), GetDocumentsWithStatsParams{
		UserID: userID,
		Offset: 1,
		Limit:  1,
	})
	suite.NoError(err)
	suite.Len(rows, 1)
	suite.Equal(documentID, rows[0].ID)
}

func (suite *DocumentsTestSuite) TestDeleteDocument() {
	changed, err := suite.dbm.Queries.DeleteDocument(context.Background(), documentID)
	suite.Nil(err, "should have nil err")
	suite.Equal(int64(1), changed, "should have changed the document")

	doc, err := suite.dbm.Queries.GetDocument(context.Background(), documentID)
	suite.Nil(err, "should have nil err")
	suite.True(doc.Deleted, "should have deleted the document")
}

func (suite *DocumentsTestSuite) TestGetDeletedDocuments() {
	changed, err := suite.dbm.Queries.DeleteDocument(context.Background(), documentID)
	suite.Nil(err, "should have nil err")
	suite.Equal(int64(1), changed, "should have changed the document")

	deletedDocs, err := suite.dbm.Queries.GetDeletedDocuments(context.Background(), []string{documentID})
	suite.Nil(err, "should have nil err")
	suite.Len(deletedDocs, 1, "should have one deleted document")
}

// TODO - Convert GetWantedDocuments -> (sqlc.slice('document_ids'));
func (suite *DocumentsTestSuite) TestGetWantedDocuments() {
	wantedDocs, err := suite.dbm.Queries.GetWantedDocuments(context.Background(), GetWantedDocumentsParams{
		JsonEach:    fmt.Sprintf("[\"%s\"]", documentID),
		DocumentIds: fmt.Sprintf("[\"%s\"]", documentID),
	})
	suite.Nil(err, "should have nil err")
	suite.Len(wantedDocs, 1, "should have one wanted document")
}

func (suite *DocumentsTestSuite) TestGetMissingDocuments() {
	// Create Document
	_, err := suite.dbm.Queries.UpsertDocument(context.Background(), UpsertDocumentParams{
		ID:       documentID,
		Filepath: &documentFilepath,
	})
	suite.NoError(err)

	missingDocs, err := suite.dbm.Queries.GetMissingDocuments(context.Background(), []string{documentID})
	suite.Nil(err, "should have nil err")
	suite.Len(missingDocs, 0, "should have no wanted document")

	missingDocs, err = suite.dbm.Queries.GetMissingDocuments(context.Background(), []string{"other"})
	suite.Nil(err, "should have nil err")
	suite.Len(missingDocs, 1, "should have one missing document")
	suite.Equal(documentID, missingDocs[0].ID, "should have missing doc")

	// TODO - https://github.com/sqlc-dev/sqlc/issues/3451
	// missingDocs, err = suite.dbm.Queries.GetMissingDocuments(context.Background(), []string{})
	// suite.Nil(err, "should have nil err")
	// suite.Len(missingDocs, 1, "should have one missing document")
	// suite.Equal(documentID, missingDocs[0].ID, "should have missing doc")
}
