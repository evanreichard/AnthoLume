package database

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/suite"

	"reichard.io/antholume/config"
)

const (
	testUserID   = "testUser"
	testUserPass = "testPass"
)

type UsersTestSuite struct {
	suite.Suite
	dbm *DBManager
}

func TestUsers(t *testing.T) {
	suite.Run(t, new(UsersTestSuite))
}

func (suite *UsersTestSuite) SetupTest() {
	suite.dbm = NewMgr(&config.Config{DBType: "memory"})
	db := suite.dbm.DB
	require := suite.Require()
	suite.T().Cleanup(func() { require.NoError(db.Close()) })
	_, err := db.Exec(`INSERT INTO users (id, pass, auth_hash) VALUES (?, ?, 'unused')`, testUserID, testUserPass)
	require.NoError(err)
}

func (suite *UsersTestSuite) TestGetUser() {
	user, err := suite.dbm.Queries.GetUser(context.Background(), testUserID)
	suite.Require().NoError(err)
	suite.Require().NotNil(user.Pass)
	suite.Equal(testUserPass, *user.Pass)
}

func (suite *UsersTestSuite) TestDeleteUser() {
	changed, err := suite.dbm.Queries.DeleteUser(context.Background(), testUserID)
	suite.Nil(err, "should have nil err")
	suite.Equal(int64(1), changed, "should have one changed row")

	_, err = suite.dbm.Queries.GetUser(context.Background(), testUserID)
	suite.ErrorIs(err, sql.ErrNoRows, "should have no rows error")
}
