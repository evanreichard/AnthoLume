package database

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/suite"

	"reichard.io/antholume/config"
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
	_, err := suite.dbm.Queries.UpsertDocument(suite.dbm.Ctx, UpsertDocumentParams{
		ID:     documentID,
		Title:  &documentTitle,
		Author: &documentAuthor,
		Words:  &documentWords,
	})
	suite.NoError(err)
}

// DOCUMENT - TODO:
//   - 󰊕  (q *Queries) GetDocumentProgress
//   - 󰊕  (q *Queries) GetDocumentWithStats
//   - 󰊕  (q *Queries) GetDocumentsSize
//   - 󰊕  (q *Queries) GetDocumentsWithStats
//   - 󰊕  (q *Queries) GetMissingDocuments
func (suite *DocumentsTestSuite) TestGetDocument() {
	doc, err := suite.dbm.Queries.GetDocument(suite.dbm.Ctx, documentID)
	suite.Nil(err, "should have nil err")
	suite.Equal(documentID, doc.ID, "should have changed the document")
}

func (suite *DocumentsTestSuite) TestUpsertDocument() {
	testDocID := "docid1"

	doc, err := suite.dbm.Queries.UpsertDocument(suite.dbm.Ctx, UpsertDocumentParams{
		ID:     testDocID,
		Title:  &documentTitle,
		Author: &documentAuthor,
	})

	suite.Nil(err, "should have nil err")
	suite.Equal(testDocID, doc.ID, "should have document id")
	suite.Equal(documentTitle, *doc.Title, "should have document title")
	suite.Equal(documentAuthor, *doc.Author, "should have document author")
}

func (suite *DocumentsTestSuite) TestDeleteDocument() {
	changed, err := suite.dbm.Queries.DeleteDocument(suite.dbm.Ctx, documentID)
	suite.Nil(err, "should have nil err")
	suite.Equal(int64(1), changed, "should have changed the document")

	doc, err := suite.dbm.Queries.GetDocument(suite.dbm.Ctx, documentID)
	suite.Nil(err, "should have nil err")
	suite.True(doc.Deleted, "should have deleted the document")
}

func (suite *DocumentsTestSuite) TestGetDeletedDocuments() {
	changed, err := suite.dbm.Queries.DeleteDocument(suite.dbm.Ctx, documentID)
	suite.Nil(err, "should have nil err")
	suite.Equal(int64(1), changed, "should have changed the document")

	deletedDocs, err := suite.dbm.Queries.GetDeletedDocuments(suite.dbm.Ctx, []string{documentID})
	suite.Nil(err, "should have nil err")
	suite.Len(deletedDocs, 1, "should have one deleted document")
}

// TODO - Convert GetWantedDocuments -> (sqlc.slice('document_ids'));
func (suite *DocumentsTestSuite) TestGetWantedDocuments() {
	wantedDocs, err := suite.dbm.Queries.GetWantedDocuments(suite.dbm.Ctx, fmt.Sprintf("[\"%s\"]", documentID))
	suite.Nil(err, "should have nil err")
	suite.Len(wantedDocs, 1, "should have one wanted document")
}

func (suite *DocumentsTestSuite) TestGetMissingDocuments() {
	// Create Document
	_, err := suite.dbm.Queries.UpsertDocument(suite.dbm.Ctx, UpsertDocumentParams{
		ID:       documentID,
		Filepath: &documentFilepath,
	})
	suite.NoError(err)

	missingDocs, err := suite.dbm.Queries.GetMissingDocuments(suite.dbm.Ctx, []string{documentID})
	suite.Nil(err, "should have nil err")
	suite.Len(missingDocs, 0, "should have no wanted document")

	missingDocs, err = suite.dbm.Queries.GetMissingDocuments(suite.dbm.Ctx, []string{"other"})
	suite.Nil(err, "should have nil err")
	suite.Len(missingDocs, 1, "should have one missing document")
	suite.Equal(documentID, missingDocs[0].ID, "should have missing doc")

	// TODO - https://github.com/sqlc-dev/sqlc/issues/3451
	// missingDocs, err = suite.dbm.Queries.GetMissingDocuments(suite.dbm.Ctx, []string{})
	// suite.Nil(err, "should have nil err")
	// suite.Len(missingDocs, 1, "should have one missing document")
	// suite.Equal(documentID, missingDocs[0].ID, "should have missing doc")
}
