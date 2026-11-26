package database

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/suite"

	"reichard.io/antholume/config"
)

var (
	documentID       = "testDocument"
	documentTitle    = "testTitle"
	documentAuthor   = "testAuthor"
	documentFilepath = "./testPath.epub"
	documentWords    = int64(5000)
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

	deletedDocs, err := suite.dbm.Queries.GetDeletedDocuments(context.Background(), fmt.Sprintf(`[%q]`, documentID))
	suite.Nil(err, "should have nil err")
	suite.Len(deletedDocs, 1, "should have one deleted document")
}

func (suite *DocumentsTestSuite) TestGetWantedDocuments() {
	wantedDocs, err := suite.dbm.Queries.GetWantedDocuments(context.Background(), fmt.Sprintf("[\"%s\"]", documentID))
	suite.Nil(err, "should have nil err")
	suite.Len(wantedDocs, 1, "should have one wanted document")
}

func (suite *DocumentsTestSuite) TestGetMissingDocuments() {
	// Create Document
	_, err := suite.dbm.Queries.UpsertDocument(context.Background(), UpsertDocumentParams{
		ID:       documentID,
		Filepath: &documentFilepath,
	})
	suite.Require().NoError(err)

	for _, tc := range []struct {
		name, inventory string
		wantIDs         []string
	}{
		{"empty inventory excludes nothing", `[]`, []string{documentID}},
		{"held document is excluded", fmt.Sprintf(`[%q]`, documentID), nil},
		{"unrelated ID does not exclude the document", `["other"]`, []string{documentID}},
	} {
		suite.Run(tc.name, func() {
			docs, err := suite.dbm.Queries.GetMissingDocuments(suite.T().Context(), tc.inventory)
			suite.Require().NoError(err)
			var ids []string
			for _, doc := range docs {
				ids = append(ids, doc.ID)
			}
			suite.ElementsMatch(tc.wantIDs, ids)
		})
	}
}
